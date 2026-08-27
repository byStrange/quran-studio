#!/bin/bash
ARGS=()
ABI=""
IS_BUILD=0
for arg in "$@"; do
    if [[ "$arg" == "--build" ]]; then
        IS_BUILD=1
    fi
    ARGS+=("$arg")
done

if [[ "$IS_BUILD" == "0" ]]; then
    if [[ "$*" == *"aarch64-linux-android"* ]]; then
        ABI="arm64-v8a"
    elif [[ "$*" == *"armv7-linux-androideabi"* ]]; then
        ABI="armeabi-v7a"
    elif [[ "$*" == *"i686-linux-android"* ]]; then
        ABI="x86"
    elif [[ "$*" == *"x86_64-linux-android"* ]]; then
        ABI="x86_64"
    fi

    if [[ -n "$ABI" ]]; then
        ARGS+=("-DANDROID_ABI=$ABI")
        ARGS+=("-DCMAKE_ANDROID_ARCH_ABI=$ABI")
    fi
fi

exec /usr/bin/cmake "${ARGS[@]}"
