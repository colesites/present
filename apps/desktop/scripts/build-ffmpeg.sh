#!/usr/bin/env bash
# Builds the FFmpeg that ships inside Present (ADR-003).
#
# LGPL only: shared libraries, no --enable-gpl, no --enable-nonfree, no
# --enable-version3, and nothing autodetected, so no external library can pull
# a licence in unnoticed. The script refuses to finish if the result says
# otherwise.
#
# Only what the app uses is built: every decoder and demuxer, the platform's GPU
# decoder, swscale, and on macOS the filters `scale_vt` needs. A few encoders
# and one muxer stay for the decoder's tests, which write their own clips.
#
#   scripts/build-ffmpeg.sh            # build if the pinned build is not there
#   FFMPEG_JOBS=4 scripts/build-ffmpeg.sh
#
# Output, under src-tauri/ffmpeg/ (git-ignored):
#   cache/    the source tarball, checked against its SHA-256
#   build/    FFmpeg's object files; safe to delete
#   prefix/   headers and libraries, which FFMPEG_DIR points the Rust build at
#
# macOS and Linux run it as is. Windows runs it in MSYS2 from an MSVC developer
# environment (cl.exe on PATH), which is what the CI workflow sets up.
#
# x86 needs nasm for FFmpeg's assembly. Without it the build stops, unless
# PRESENT_FFMPEG_NO_ASM=1 asks for a slower build, for trying the packaging on a
# machine that lacks nasm. Never ship one.

set -euo pipefail

VERSION="9.0.1"
SHA256="cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635"
URL="https://ffmpeg.org/releases/ffmpeg-${VERSION}.tar.xz"

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${DESKTOP_DIR}/src-tauri/ffmpeg"
CACHE="${ROOT}/cache"
BUILD="${ROOT}/build"
PREFIX="${ROOT}/prefix"
TARBALL="${CACHE}/ffmpeg-${VERSION}.tar.xz"

log() { printf '[build-ffmpeg] %s\n' "$*"; }
fail() { printf '[build-ffmpeg] %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) OS=macos ;;
  Linux) OS=linux ;;
  MINGW* | MSYS* | CYGWIN*) OS=windows ;;
  *) fail "unsupported system: $(uname -s)" ;;
esac
ARCH="$(uname -m)"

FLAGS=(
  --disable-autodetect
  --disable-gpl --disable-nonfree --disable-version3
  --enable-shared --disable-static --enable-pic
  --disable-programs --disable-doc --disable-debug
  --disable-network --disable-devices --disable-avdevice --disable-swresample
  # Every decoder, demuxer and parser; encoders and muxers only for the tests.
  --disable-encoders --enable-encoder=ffv1,mpeg4
  --disable-muxers --enable-muxer=matroska
  --disable-protocols --enable-protocol=file
  --disable-filters
)

case "${OS}" in
  macos)
    FLAGS+=(
      --enable-videotoolbox --enable-zlib
      --enable-encoder=h264_videotoolbox
      # The graph's buffer source and sink are always built.
      --enable-filter=scale_vt
      # The app links @rpath/libav*.dylib and finds them in Contents/Frameworks.
      --install-name-dir=@rpath
      # tauri.conf.json's minimumSystemVersion.
      --extra-cflags=-mmacosx-version-min=10.15
      --extra-ldflags=-mmacosx-version-min=10.15
    )
    ;;
  linux)
    FLAGS+=(
      --enable-vaapi --enable-zlib
      --disable-avfilter
    )
    ;;
  windows)
    FLAGS+=(
      --toolchain=msvc
      --enable-d3d11va --enable-dxva2
      --disable-avfilter
    )
    ;;
esac

if [[ "${ARCH}" == x86_64 || "${ARCH}" == amd64 ]] && ! command -v nasm >/dev/null; then
  if [[ "${PRESENT_FFMPEG_NO_ASM:-}" == 1 ]]; then
    log "nasm not found: building WITHOUT assembly (PRESENT_FFMPEG_NO_ASM=1). Do not ship this build."
    FLAGS+=(--disable-x86asm)
  else
    fail "nasm is needed for FFmpeg's x86 assembly. Install it, or set PRESENT_FFMPEG_NO_ASM=1 for a slow build that must not ship."
  fi
fi

# A build is reused only if it was made from this version with these flags.
STAMP_TEXT="${VERSION} ${FLAGS[*]}"
STAMP="${PREFIX}/BUILD-STAMP"
if [[ -f "${STAMP}" && "$(cat "${STAMP}")" == "${STAMP_TEXT}" ]]; then
  log "FFmpeg ${VERSION} already built in ${PREFIX}"
  exit 0
fi

sha256_of() {
  if command -v sha256sum >/dev/null; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

mkdir -p "${CACHE}"
if [[ ! -f "${TARBALL}" ]]; then
  log "downloading ${URL}"
  curl --fail --location --silent --show-error --output "${TARBALL}.part" "${URL}"
  mv "${TARBALL}.part" "${TARBALL}"
fi
ACTUAL="$(sha256_of "${TARBALL}")"
if [[ "${ACTUAL}" != "${SHA256}" ]]; then
  rm -f "${TARBALL}"
  fail "checksum mismatch for ${TARBALL}: expected ${SHA256}, got ${ACTUAL}"
fi

rm -rf "${BUILD}" "${PREFIX}"
mkdir -p "${BUILD}"
tar -xJf "${TARBALL}" -C "${BUILD}" --strip-components=1

JOBS="${FFMPEG_JOBS:-$( (getconf _NPROCESSORS_ONLN || sysctl -n hw.ncpu || echo 4) 2>/dev/null)}"
log "configuring FFmpeg ${VERSION} for ${OS} ${ARCH}"
(
  cd "${BUILD}"
  ./configure --prefix="${PREFIX}" "${FLAGS[@]}" >configure.log 2>&1 \
    || { tail -40 configure.log >&2; tail -40 ffbuild/config.log >&2; exit 1; }
)

# The licence the libraries will report, from FFmpeg's own configuration.
CONFIG="${BUILD}/config.h"
COMPONENTS="${BUILD}/config_components.h"
for switch in CONFIG_GPL CONFIG_NONFREE CONFIG_VERSION3; do
  grep -q "^#define ${switch} 0$" "${CONFIG}" || fail "${switch} is on: this build is not LGPL 2.1"
done
LICENSE="$(sed -n 's/^#define FFMPEG_LICENSE "\(.*\)"$/\1/p' "${CONFIG}")"
[[ "${LICENSE}" == "LGPL version 2.1 or later" ]] || fail "unexpected licence: ${LICENSE}"
if [[ "${OS}" == macos ]]; then
  grep -q "^#define CONFIG_SCALE_VT_FILTER 1$" "${COMPONENTS}" || fail "scale_vt is missing"
  grep -q "^#define CONFIG_VIDEOTOOLBOX 1$" "${CONFIG}" || fail "VideoToolbox is missing"
fi
[[ "${OS}" == linux ]] && { grep -q "^#define CONFIG_VAAPI 1$" "${CONFIG}" || fail "VA-API is missing (libva-dev?)"; }
[[ "${OS}" == windows ]] && { grep -q "^#define CONFIG_D3D11VA 1$" "${CONFIG}" || fail "D3D11 decoding is missing"; }

log "building with ${JOBS} jobs"
make -C "${BUILD}" -j"${JOBS}" >"${BUILD}/make.log" 2>&1 || { tail -40 "${BUILD}/make.log" >&2; exit 1; }
make -C "${BUILD}" install >>"${BUILD}/make.log" 2>&1 || { tail -40 "${BUILD}/make.log" >&2; exit 1; }

if [[ "${OS}" == linux ]]; then
  # Each library finds the others beside it, wherever the bundle puts them.
  for library in "${PREFIX}"/lib/lib*.so.*; do
    [[ -L "${library}" ]] || patchelf --set-rpath '$ORIGIN' "${library}"
  done
fi

# What the licence asks to travel with the libraries.
mkdir -p "${PREFIX}/share/licenses"
cp "${BUILD}/COPYING.LGPLv2.1" "${BUILD}/LICENSE.md" "${PREFIX}/share/licenses/"
{
  echo "FFmpeg ${VERSION}, built for Present as shared libraries under the"
  echo "GNU Lesser General Public License, version 2.1 or later (COPYING.LGPLv2.1)."
  echo
  echo "Source: ${URL}"
  echo "SHA-256: ${SHA256}"
  echo "Unmodified. Configured with:"
  echo "  ${FLAGS[*]}"
  echo
  echo "That exact source is published with Present, as"
  echo "ffmpeg-${VERSION}.tar.xz beside the download this copy came from. If you"
  echo "have Present without it, ask whoever gave you this copy, or the contact"
  echo "at https://present.multivrs.space, and it will be provided."
  echo
  echo "The libraries are separate files and can be replaced with a compatible"
  echo "build of your own."
} >"${PREFIX}/share/licenses/FFMPEG-SOURCE.txt"

printf '%s' "${STAMP_TEXT}" >"${STAMP}"
log "FFmpeg ${VERSION} (${LICENSE}) installed in ${PREFIX}"
