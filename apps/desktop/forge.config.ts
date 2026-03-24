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

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    protocols: [
      {
        name: 'Present',
        schemes: ['present'],
      },
    ],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({
      mimeType: ['x-scheme-handler/present'],
    }),
    new MakerDeb({
      mimeType: ['x-scheme-handler/present'],
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      devServer: {
        hot: false,
        liveReload: false,
      },
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/index.html',
            js: './src/renderer.ts',
            name: 'main_window',
            preload: {
              js: './src/preload.ts',
              config: preloadConfig,
            },
          },
          {
            html: './src/output.html',
            js: './src/output-renderer.tsx',
            name: 'output_window',
            preload: {
              js: './src/preload.ts',
              config: preloadConfig,
            },
          },
        ],
      },
      devContentSecurityPolicy: "default-src 'self' 'unsafe-inline' data: local-media:; script-src 'self' 'unsafe-eval' 'unsafe-inline'; connect-src 'self' http://localhost:3000 https://wary-badger-863.convex.site https://wary-badger-863.convex.cloud wss://wary-badger-863.convex.cloud; img-src 'self' data: local-media: https://*.gravatar.com https://*.wp.com; media-src 'self' local-media:; font-src 'self' data: https:;",
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
