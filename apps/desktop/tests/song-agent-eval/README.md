# Song agent eval

The song agent replayed against what AssemblyAI really heard in recordings of
singing, to measure it before and after a change.

| File | Holds |
| --- | --- |
| `songs.mjs` | The library: public-domain hymns, as slides |
| `originals.mjs` | Songs written for this test, as slides |
| `recordings.mjs` | Each recording: its song, its sound file, where it came from, its licence; for a synthetic one, the order it is sung in |
| `truth.mjs` | When each slide began in each sung recording, checked by hand |
| `synth.mjs` | Makes the synthetic recordings and their exact timing |
| `capture.mjs`, `capture-all.sh` | Stream recordings to AssemblyAI at true speed, saving every message and when it came |
| `run.mjs` | Following: how late each slide came up, slides missed, wrong slides |
| `find.mjs` | Finding the song: service first, then the library, and false alarms |
| `find-starts.mjs` | A first draft of a recording's `truth.mjs` entry |

## Running it

```sh
# The sung recordings (LibriVox, public domain), as 16 kHz mono PCM
mkdir -p /tmp/song-eval-audio && cd /tmp/song-eval-audio
for file in amazinggrace_meg itiswellwithmysoul_jc blessedassurance_mfslaw isurrenderall_ezwa \
  softlyandtenderly_bt trustandobey_tg tissosweettotrustinjesus_jle rockofages_lw; do
  curl -sL -o $file.mp3 https://archive.org/download/hymn_collection_001_0909_librivox/hymns001_${file}_64kb.mp3
  ffmpeg -loglevel error -i $file.mp3 -ac 1 -ar 16000 -f s16le $file.pcm
done
cd -

# The synthetic recordings (macOS voices)
node tests/song-agent-eval/synth.mjs --out /tmp/song-eval-audio

# What AssemblyAI hears, with the app's settings (about 10 minutes)
ASSEMBLYAI_API_KEY=… sh tests/song-agent-eval/capture-all.sh /tmp/song-eval-audio /tmp/heard \
  --keyterms words --turn-silence 2000 --sure-silence 800

node tests/song-agent-eval/run.mjs --heard /tmp/heard
node tests/song-agent-eval/find.mjs --heard /tmp/heard --distractors 500
```

`run.mjs --ahead` measures the "Change on the last word" setting.

For a before and after, replay the old matcher with `--matcher <file>`
(`git show <commit>:apps/desktop/src/features/song-agent/song-match.mjs`).
To capture with the settings it had before, use `--keyterms title` and leave
out the two silence options.

Each of the sung recordings is one volunteer singing, recorded for
LibriVox, with little or no band to be heard in what the service sent back.
A worship band heard through a room microphone will be harder; the
synthetic recordings, with a band under the voice, are closer to that, and
the service heard far fewer of their words.
