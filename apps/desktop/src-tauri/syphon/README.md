# Syphon

`Syphon.framework` is what a screen's Syphon output publishes with
(`src/services/syphon.rs`): other apps on the same Mac, such as OBS, Resolume
or MadMapper, take the picture straight from the GPU.

- Source: [Syphon/Syphon-Framework](https://github.com/Syphon/Syphon-Framework)
  at commit `f4761677a45b8034a3c2069ec0f3d2553da81fba` (21 September 2026).
  The 2019 "Syphon SDK 5" release has no Metal server, so it is built from
  source.
- Licence: BSD, in `LICENSE.txt`, which the Mac bundle carries beside it.
- Built universal (x86_64 and arm64), for macOS 10.15 on, and ad-hoc signed.
  The app's signing re-signs it when the bundle is made
  (`tauri.macos.conf.json` lists it under `frameworks`).
- One change, `runtime-shaders.patch`: Syphon's shader is compiled when a
  server starts, from the same source, instead of from the `default.metallib`
  that Xcode builds with its separate Metal Toolchain.

Present loads the framework when a Syphon output is first wanted: from
`Contents/Frameworks` in the app, and in a development build from here. A
build without it runs, and says Syphon is unavailable.

To rebuild it, or move to another commit, run `scripts/build-syphon.sh`.
