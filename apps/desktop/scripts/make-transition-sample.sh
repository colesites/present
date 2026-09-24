#!/usr/bin/env bash
# The motion background the transition picker's tiles play over.
#
# Generated rather than filmed, so there is nobody's footage inside the app
# and it can be made again: soft lights rising over a slowly turning field of
# colour, the look of the backgrounds churches actually put behind lyrics.
#
# Seventeen frames, one for each step of a tile's play
# (`features/transitions/TransitionTile.tsx`), stacked one under another in a
# single JPEG that `services/compositor/transition/sample.rs` embeds.
#
# Usage: scripts/make-transition-sample.sh   (needs `ffmpeg` on the PATH)
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
out="$here/src-tauri/assets/transition-sample.jpg"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Each light: where it starts (fractions of the frame), its radius (of the
# height) and how bright it is. They rise a tenth of the frame over the play
# and sway a little.
lights="0"
index=0
while read -r x y radius brightness; do
  lights="$lights+$brightness/(1+exp((hypot(X-W*($x+0.015*sin(T*2.5+$index)),Y-H*($y-0.11*T))-H*$radius)/(H*0.012)))"
  index=$((index + 1))
done <<'LIGHTS'
0.10 0.78 0.075 62
0.27 0.30 0.050 52
0.46 0.66 0.095 44
0.64 0.24 0.060 58
0.83 0.72 0.045 70
0.93 0.36 0.070 42
0.20 0.10 0.040 60
0.72 0.95 0.085 48
0.55 0.12 0.030 76
0.36 0.92 0.035 66
LIGHTS

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "gradients=s=640x360:r=20:d=0.85:n=4:c0=0x10163a:c1=0x33207a:c2=0x7a2466:c3=0x0f4f78:speed=0.02:seed=11:type=linear" \
  -vf "format=gbrp,geq=r='min(255,r(X,Y)+1.00*($lights))':g='min(255,g(X,Y)+0.82*($lights))':b='min(255,b(X,Y)+0.95*($lights))',gblur=sigma=2.2,vignette=PI/5,eq=saturation=1.15,scale=320:180:flags=lanczos,format=rgb24" \
  -frames:v 17 -start_number 0 "$work/frame-%02d.png"

ffmpeg -hide_banner -loglevel error -y -start_number 0 -i "$work/frame-%02d.png" \
  -vf "tile=1x17" -frames:v 1 -q:v 3 -update 1 "$out"

echo "wrote $out ($(wc -c < "$out" | tr -d ' ') bytes)"
