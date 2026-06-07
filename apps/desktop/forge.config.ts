import path from 'path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';
import { preloadConfig } from './webpack.preload.config';
import { buildDesktopContentSecurityPolicy } from './csp';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { stageNdiModules, STAGE_NODE_MODULES } = require(
  path.resolve(__dirname, 'scripts/stage-ndi.cjs'),
) as {
  stageNdiModules: () => boolean;
  STAGE_NODE_MODULES: string;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { stageWhisper, STAGE_WHISPER } = require(
  path.resolve(__dirname, 'scripts/stage-whisper.cjs'),
) as {
  stageWhisper: () => boolean;
  STAGE_WHISPER: string;
};

const iconBasePath = path.resolve(__dirname, 'assets/icons/present');
const linuxIconPath = path.resolve(__dirname, 'assets/icons/present.png');

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: 'Present',
    extraResource: [
      path.resolve(__dirname, 'bible'),
      path.resolve(__dirname, 'assets/icons'),
      path.resolve(__dirname, 'parse_pptx.py'),
      // Native NDI backend, shipped UNPACKED (outside app.asar) so the .node
      // addon loads and the ESM entry resolves by absolute path at runtime.
      // Populated by the prePackage hook below → Resources/node_modules.
      STAGE_NODE_MODULES,
      // Self-contained whisper-cli + dylibs + ggml backends + base.en model,
      // shipped UNPACKED → Resources/whisper/<platform> and
      // Resources/whisper/models. Populated by the prePackage hook.
      STAGE_WHISPER,
    ],
    icon: iconBasePath,
    extendInfo: {
      NSMicrophoneUsageDescription:
        "Present uses the microphone for voice scripture search and speech controls.",
    },
    extendHelperInfo: {
      NSMicrophoneUsageDescription:
        "Present uses the microphone for voice scripture search and speech controls.",
    },
    protocols: [
      {
        name: 'Present',
        schemes: ['present'],
      },
    ],
  },
  rebuildConfig: {},
  hooks: {
    // Stage native sidecars before packaging so the extraResource copies pick
    // them up: NDI modules → Resources/node_modules, whisper bundle →
    // Resources/whisper.
    prePackage: async () => {
      stageNdiModules();
      stageWhisper();
    },
  },
  makers: [
    new MakerSquirrel({
      // Squirrel uses this as the NuGet package id, so it cannot contain the
      // slash from the workspace package name "@present/desktop".
      name: 'present',
    }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({
      options: {
        bin: 'Present',
        icon: linuxIconPath,
        mimeType: ['x-scheme-handler/present'],
        name: 'present',
        productName: 'Present',
      },
    }),
    new MakerDeb({
      options: {
        bin: 'Present',
        icon: linuxIconPath,
        mimeType: ['x-scheme-handler/present'],
        name: 'present',
        productName: 'Present',
      },
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      port: 3000,
      loggerPort: 3003,
      devServer: {
        hot: false,
        liveReload: false,
      },
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/renderer/main/index.html',
            js: './src/renderer/main/main-renderer.ts',
            name: 'main_window',
            preload: {
              js: './src/main/preload.ts',
              config: preloadConfig,
            },
          },
          {
            html: './src/renderer/output/output.html',
            js: './src/renderer/output/output-renderer.tsx',
            name: 'output_window',
            preload: {
              js: './src/main/preload.ts',
              config: preloadConfig,
            },
          },
        ],
      },
      devContentSecurityPolicy: buildDesktopContentSecurityPolicy(),
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
