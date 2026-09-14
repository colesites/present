# ndi/

The NDI runtime shipped inside the Tauri bundle, staged here by
`scripts/stage-tauri-ndi.mjs` from grandi's prebuilt package for the platform
doing the build. It is the same `libndi` the Electron build ships.

Nothing here but this file and `.gitignore` is committed. The directory exists
so `bundle.resources` in `tauri.conf.json` always names something, including on
a machine with no NDI package installed — that bundle then uses an installed
NDI runtime if there is one, and reports NDI as unavailable if not.

The loader that looks here is `src/services/ndi/library.rs`.
