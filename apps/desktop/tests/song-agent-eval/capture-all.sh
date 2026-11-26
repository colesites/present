#!/bin/sh
# Every recording in `recordings.mjs`, captured with the same settings, four
# at a time (the service refuses more than about five sessions at once).
#
#   ASSEMBLYAI_API_KEY=… sh tests/song-agent-eval/capture-all.sh <audio dir of .pcm> <out dir> [capture options…]
set -e
cd "$(dirname "$0")/../.."
audio="$1"
out="$2"
shift 2
mkdir -p "$out"
node -e 'import("./tests/song-agent-eval/recordings.mjs").then(({ RECORDINGS }) => { for (const { id, song, file } of RECORDINGS) console.log(`${id} ${song} ${file}`) })' |
  xargs -P 4 -L 1 sh -c 'node tests/song-agent-eval/capture.mjs --song "$1" --audio "'"$audio"'/$2.pcm" --out "'"$out"'/$0.json" '"$*"
