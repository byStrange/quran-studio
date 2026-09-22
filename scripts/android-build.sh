#!/usr/bin/env bash
#
# Build the Android APK.
#
# The Tauri CLI needs three things pointed at it that a desktop build does not:
# the SDK, the NDK it cross-compiles Rust against, and a JDK 17 for Gradle.
# Rather than ask everyone to keep those exported, this discovers them and
# fails with a specific message when one is genuinely missing.
#
#   pnpm app:android                      # debug APK, arm64, sideloadable
#   pnpm app:android --apk                # unsigned release APK
#   pnpm app:android --apk --aab --target aarch64 --target x86_64
#
# With no arguments it builds the fast path: one architecture, debug-signed,
# which is the only combination that installs on a phone without a keystore.
# Any argument you pass replaces that default entirely.

set -euo pipefail

die() {
  echo "error: $*" >&2
  exit 1
}

# --- SDK -------------------------------------------------------------------

: "${ANDROID_HOME:=${ANDROID_SDK_ROOT:-/opt/android-sdk}}"
ANDROID_HOME="${ANDROID_HOME%/}"
[ -d "$ANDROID_HOME" ] || die "no Android SDK at $ANDROID_HOME (set ANDROID_HOME)"
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# --- NDK -------------------------------------------------------------------
# Highest installed version, so an SDK update does not need an edit here.

if [ -z "${NDK_HOME:-}" ]; then
  [ -d "$ANDROID_HOME/ndk" ] || die "no NDK under $ANDROID_HOME/ndk — install one with: sdkmanager 'ndk;27.1.12297006'"
  ndk_version="$(ls -1 "$ANDROID_HOME/ndk" | sort -V | tail -1)"
  [ -n "$ndk_version" ] || die "no NDK under $ANDROID_HOME/ndk — install one with: sdkmanager 'ndk;27.1.12297006'"
  NDK_HOME="$ANDROID_HOME/ndk/$ndk_version"
fi
[ -d "$NDK_HOME" ] || die "NDK_HOME points at $NDK_HOME, which does not exist"
export NDK_HOME
export ANDROID_NDK_HOME="$NDK_HOME"
export ANDROID_NDK_ROOT="$NDK_HOME"
export CMAKE_TOOLCHAIN_FILE="$NDK_HOME/build/cmake/android.toolchain.cmake"

# --- JDK -------------------------------------------------------------------
# The Android Gradle plugin wants 17. A newer default JDK on PATH is a common
# cause of an unhelpful Gradle failure, so prefer an explicit 17 when present.

if [ -z "${JAVA_HOME:-}" ]; then
  for candidate in /usr/lib/jvm/java-17-openjdk /usr/lib/jvm/java-17-openjdk-amd64 /usr/lib/jvm/default; do
    if [ -x "$candidate/bin/java" ]; then
      JAVA_HOME="$candidate"
      break
    fi
  done
fi
if [ -z "${JAVA_HOME:-}" ]; then
  command -v java >/dev/null 2>&1 || die "no JDK found — install one (JDK 17 is what the Android Gradle plugin expects)"
  echo "warning: no JDK 17 found; falling back to java on PATH" >&2
else
  export JAVA_HOME
fi

# --- Rust targets ----------------------------------------------------------

if command -v rustup >/dev/null 2>&1; then
  if ! rustup target list --installed | grep -q -- '-linux-android'; then
    die "no Android Rust targets installed — run: rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android"
  fi
else
  echo "warning: rustup not found; assuming the Android targets are available" >&2
fi

# --- Build -----------------------------------------------------------------

export PATH="$(cd "$(dirname "$0")" && pwd):$PATH"
export CMAKE="$(cd "$(dirname "$0")" && pwd)/cmake-wrapper.sh"
# Relative, and pointed at a name rather than a path: an absolute symlink is
# only correct on the machine that wrote it, so every build on a different
# checkout used to rewrite it and leave the tree dirty.
ln -sfn cmake-wrapper.sh "$(cd "$(dirname "$0")" && pwd)/cmake"

cd "$(dirname "$0")/.."

# Inject RECORD_AUDIO permission if missing
if [ -f src-tauri/gen/android/app/src/main/AndroidManifest.xml ]; then
  if ! grep -q "android.permission.RECORD_AUDIO" src-tauri/gen/android/app/src/main/AndroidManifest.xml; then
    sed -i '/<uses-permission android:name="android.permission.INTERNET"/a \    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />' src-tauri/gen/android/app/src/main/AndroidManifest.xml
  fi
fi

# src-tauri/gen is gitignored, so a fresh clone has no Gradle project to build.
# `--init` generates one; it is a sibling subcommand, not a build flag.
#
# `android init` lays down the stock template icons — the Tauri logo on the
# green Android background — and there is no hook to override them. `tauri
# icon` writes the launcher mipmaps straight into the Gradle project once it
# exists, so it has to run after init, and again after any re-init, or the APK
# ships the template icon.
if [ "${1:-}" = "--init" ]; then
  echo "ANDROID_HOME=$ANDROID_HOME"
  echo "NDK_HOME=$NDK_HOME"
  npx tauri android init
  exec npx tauri icon src-tauri/icon-source.svg
fi

if [ "$#" -gt 0 ]; then
  args=("$@")
else
  args=(--apk --debug --target aarch64)
fi

# `tauri android build` has no `--release`: release is what it does unless
# `--debug` says otherwise, and passing it is an error rather than a no-op.
# It reads as the obvious opposite of `--debug`, though, and this script's own
# usage advertised it until recently — so it is accepted and dropped here
# rather than failing a twenty-minute build over a flag that means what the
# caller already wanted.
filtered=()
for arg in "${args[@]}"; do
  if [ "$arg" = "--release" ]; then
    echo "note: ignoring --release; it is the default for 'tauri android build'" >&2
    continue
  fi
  filtered+=("$arg")
done
# `--release` on its own was the documented way to ask for one, and dropping
# it would otherwise leave nothing to build.
if [ "${#filtered[@]}" -eq 0 ]; then
  filtered=(--apk --target aarch64)
fi
args=("${filtered[@]}")

# Gradle rewrites the APK in place without compacting it, so each rebuild
# strands the previous copy of the 200MB native library inside the file: the
# central directory lists it once, the archive still carries it twice. Three
# builds in and the APK has doubled for no reason. Deleting the previous
# output costs nothing, unlike a clean build, which would recompile Rust.
rm -f src-tauri/gen/android/app/build/outputs/apk/*/*/*.apk
rm -f src-tauri/gen/android/app/build/outputs/bundle/*/*.aab

echo "ANDROID_HOME=$ANDROID_HOME"
echo "NDK_HOME=$NDK_HOME"
echo "JAVA_HOME=${JAVA_HOME:-<system default>}"
echo "tauri android build ${args[*]}"
echo

npx tauri android build "${args[@]}"
