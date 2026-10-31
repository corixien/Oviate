#!/usr/bin/env bash
# Build the Android debug APK and install it on the phone that is connected with adb (USB debugging on).
# Toolchain (installed once, no sudo): rustup with the android targets in ~/.cargo, JDK 17 in ~/.android-tools/jdk17, Android SDK + NDK in ~/Android/Sdk.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}" ANDROID_SDK_ROOT="${ANDROID_HOME}"
export NDK_HOME="${NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* | tail -1)}"
export JAVA_HOME="${JAVA_HOME:-$(ls -d "$HOME"/.android-tools/jdk17/jdk-* | head -1)}"
npx tauri android build --debug --target aarch64 --apk
APK=src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb install -r "$APK"
adb shell am start -n dev.oviate.app/.MainActivity
