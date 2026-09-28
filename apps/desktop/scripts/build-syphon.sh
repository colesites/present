#!/usr/bin/env bash
# Rebuilds the Syphon.framework that ships inside Present on a Mac
# (src-tauri/syphon, services/syphon.rs). The built framework is committed, so
# nothing runs this in a normal build: it is for moving to another Syphon
# commit, or checking that the one committed is what this source makes.
#
#   scripts/build-syphon.sh
#
# Syphon's Metal server needs its one shader, which Xcode compiles with its
# separate Metal Toolchain. So as not to need that, the shader file is left out
# of the build and runtime-shaders.patch compiles the same shader when a
# server starts.
#
# Universal (x86_64 and arm64), for macOS 10.15 on, ad-hoc signed; the app's
# own signing re-signs it when the bundle is made.

set -euo pipefail

COMMIT="f4761677a45b8034a3c2069ec0f3d2553da81fba"
# GitHub makes this archive on request. Should its bytes ever change for the
# same commit, check the commit's source and update the hash.
SHA256="a3766088c46588c42b087f4e5ff7ae7bb0f83292af59a0aeb8bba69eba5311c5"

HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HERE/src-tauri/syphon"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -sSfL -o "$WORK/syphon.tar.gz" "https://codeload.github.com/Syphon/Syphon-Framework/tar.gz/$COMMIT"
echo "$SHA256  $WORK/syphon.tar.gz" | shasum -a 256 -c -
tar xzf "$WORK/syphon.tar.gz" -C "$WORK"
SOURCE="$WORK/Syphon-Framework-$COMMIT"
patch -d "$SOURCE" -p1 < "$OUT/runtime-shaders.patch"

xcodebuild -project "$SOURCE/Syphon.xcodeproj" -scheme Syphon -configuration Release \
  -derivedDataPath "$WORK/build" \
  ARCHS="x86_64 arm64" ONLY_ACTIVE_ARCH=NO MACOSX_DEPLOYMENT_TARGET=10.15 \
  CODE_SIGNING_ALLOWED=NO EXCLUDED_SOURCE_FILE_NAMES=SyphonMetalShaders.metal \
  build >"$WORK/xcodebuild.log" || { tail -40 "$WORK/xcodebuild.log"; exit 1; }

rm -rf "$OUT/Syphon.framework"
cp -R "$WORK/build/Build/Products/Release/Syphon.framework" "$OUT/"
cp "$SOURCE/License.txt" "$OUT/LICENSE.txt"
codesign --force --sign - "$OUT/Syphon.framework"
lipo -info "$OUT/Syphon.framework/Syphon"
echo "[build-syphon] $OUT/Syphon.framework"
