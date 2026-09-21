#!/usr/bin/env bash
#
# Cut a release.
#
#   pnpm release 0.2.0        bump, commit, tag, push — CI builds and publishes
#   pnpm release 0.2.0 --dry  show what it would do, change nothing
#
# This does not build anything. Pushing the tag is the whole trigger: the
# Release workflow builds the Android APK and the Linux AppImage, writes the
# notes from the commits since the last tag, and publishes the GitHub Release.
# Doing it here instead would tie what ships to whatever this one machine can
# build, and an Android APK is not one of those things.
#
# The version is written to package.json and tauri.conf.json together, because
# they are the two places the app reports its own version from and a release
# tagged v0.2.0 whose About screen says 0.1.0 is worse than no version at all.

set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

cd "$(dirname "$0")/.."

version="${1:-}"
dry="${2:-}"
[ -n "$version" ] || die "usage: pnpm release <version> [--dry]   e.g. pnpm release 0.2.0"

# Tolerate a leading v, store without one: package.json wants 0.2.0, the tag
# wants v0.2.0, and mixing them up is the obvious way to get this wrong.
version="${version#v}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
  || die "'$version' is not a semver version (expected e.g. 0.2.0)"
tag="v$version"

git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"
[ -z "$(git status --porcelain)" ] || die "working tree is dirty — commit or stash first"
git rev-parse --verify --quiet "refs/tags/$tag" >/dev/null && die "tag $tag already exists"

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || echo "warning: releasing from '$branch', not main" >&2

current="$(node -p "require('./package.json').version")"

echo "  $current  ->  $version"
echo
echo "Release notes:"
echo
bash scripts/changelog.sh HEAD | sed 's/^/  /'
echo

if [ "$dry" = "--dry" ]; then
  echo "(--dry: nothing written)"
  exit 0
fi

read -r -p "Tag and push $tag? [y/N] " reply
[ "$reply" = "y" ] || [ "$reply" = "Y" ] || die "aborted"

# Edited in place with a version-key-only match rather than a JSON round trip,
# which would reformat both files and bury the one-line change in noise.
node -e '
  const fs = require("fs");
  const version = process.argv[1];
  for (const file of ["package.json", "src-tauri/tauri.conf.json"]) {
    const before = fs.readFileSync(file, "utf8");
    const after = before.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
    if (before === after) { console.error(`no version key in ${file}`); process.exit(1); }
    fs.writeFileSync(file, after);
  }
' "$version"

# Cargo.toml carries it too when it is kept in step; not every project keeps it
# in step, so this is a best-effort match rather than a hard requirement.
if grep -q '^version = ' src-tauri/Cargo.toml 2>/dev/null; then
  sed -i -E "0,/^version = \".*\"/s//version = \"$version\"/" src-tauri/Cargo.toml
fi

git add package.json src-tauri/tauri.conf.json
git add src-tauri/Cargo.toml src-tauri/Cargo.lock 2>/dev/null || true
git commit -m "chore: release $tag"
git tag -a "$tag" -m "$tag"
git push origin "$branch"
git push origin "$tag"

echo
echo "Pushed $tag. The Release workflow is building:"
remote="$(git config --get remote.origin.url)"
slug="$(printf '%s' "$remote" | sed -E 's#^(git@github.com:|https://github.com/)##; s#\.git$##')"
echo "  https://github.com/$slug/actions"
