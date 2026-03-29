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
      devContentSecurityPolicy:
        "default-src 'self' 'unsafe-inline' data: local-media:; " +
        "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.clerk.accounts.dev https://certain-goat-83.clerk.accounts.dev; " +
        "connect-src 'self' http://localhost:3000 http://localhost:3001 http://127.0.0.1:3001 ws://localhost:* ws://127.0.0.1:* wss://localhost:* wss://127.0.0.1:* https://present-gha.vercel.app https://present.app https://wary-badger-863.convex.site https://wary-badger-863.convex.cloud wss://wary-badger-863.convex.cloud https://*.clerk.accounts.dev https://clerk.certain-goat-83.accounts.dev; " +
        "img-src 'self' data: local-media: https://*.gravatar.com https://*.wp.com https://lh3.googleusercontent.com https://*.googleusercontent.com https://img.clerk.com; " +
        "media-src 'self' local-media:; " +
        "font-src 'self' data: https:; " +
        "frame-src https://*.clerk.accounts.dev https://clerk.certain-goat-83.accounts.dev;",
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
