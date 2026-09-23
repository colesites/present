# ffmpeg/

The FFmpeg that Present decodes video with and ships inside its bundles
(ADR-003). Only the READMEs are committed.

| Directory | Made by | Holds |
|---|---|---|
| `cache/` | `scripts/build-ffmpeg.sh` | the pinned source tarball, checked against its SHA-256 |
| `build/` | `scripts/build-ffmpeg.sh` | object files; safe to delete |
| `prefix/` | `scripts/build-ffmpeg.sh` | headers and libraries; `FFMPEG_DIR` for the Rust build |
| `runtime/` | `scripts/stage-tauri-ffmpeg.mjs` | the libraries the bundle carries |
| `licenses/` | `scripts/stage-tauri-ffmpeg.mjs` | the notices the bundle carries, beside this directory's README |

`bun run --filter @present/desktop tauri:build` does all of it, then builds the
bundle linked against `prefix/`. `bun run --filter @present/desktop tauri:ffmpeg`
builds and stages without bundling.

The build is LGPL 2.1 only, and the script refuses to finish otherwise. Never
point a bundle at a system FFmpeg: Homebrew's, and most Linux distributions',
are GPL builds.

Development links whatever FFmpeg the machine has, so none of this is needed
to run the app — except on Windows, where the libraries are bundle resources
that sit beside the executable: run `tauri:ffmpeg` once before `tauri:dev`, or
the build stops saying `runtime/` is missing.

Where each bundle puts the libraries: `tauri.macos.conf.json` (the app's
`Frameworks`), `tauri.windows.conf.json` (beside the executable) and
`tauri.linux.conf.json` (`/usr/lib/present-ffmpeg`). `build.rs` sets the search
path to match.
