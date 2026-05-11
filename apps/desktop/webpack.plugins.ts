import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
import * as webpack from 'webpack';
import * as dotenv from 'dotenv';

const lifecycleEvent = process.env.npm_lifecycle_event;
const isDevStart = lifecycleEvent === 'start' || process.env.NODE_ENV === 'development';
const DEFAULT_DESKTOP_CONVEX_URL = 'https://wary-iguana-735.convex.cloud';
const DEFAULT_DESKTOP_WEB_APP_URL = 'https://present.c-technology-inc.com';
const preferredEnvFile = isDevStart ? '.env.local' : '.env.production';
const preferredEnvPath = path.resolve(__dirname, preferredEnvFile);
const fallbackEnvPath = path.resolve(__dirname, '.env');

const preferredEnvConfig = dotenv.config({ path: preferredEnvPath });
if (preferredEnvConfig.error) {
  const fallbackEnvConfig = dotenv.config({ path: fallbackEnvPath });
  if (fallbackEnvConfig.error) {
    console.warn(
      `[Webpack Config] Warning: ${preferredEnvFile} and .env were not found. Using shell environment.`,
    );
  } else {
    console.log(`[Webpack Config] Loaded fallback environment file: ${fallbackEnvPath}`);
  }
} else {
  console.log(`[Webpack Config] Loaded environment file: ${preferredEnvPath}`);
}

const resolveDesktopEnv = (
  key: 'CONVEX_URL' | 'WEB_APP_URL',
  fallbackValue: string,
): string => {
  const configured = process.env[key]?.trim();
  if (configured) {
    return configured;
  }

  if (!isDevStart) {
    console.warn(
      `[Webpack Config] ${key} is not set for desktop build. Falling back to ${fallbackValue}.`,
    );
  }

  return fallbackValue;
};

const resolvedConvexUrl = resolveDesktopEnv('CONVEX_URL', DEFAULT_DESKTOP_CONVEX_URL);
const resolvedWebAppUrl = resolveDesktopEnv('WEB_APP_URL', DEFAULT_DESKTOP_WEB_APP_URL);

export const createWebpackPlugins = (): webpack.WebpackPluginInstance[] => [
  new ForkTsCheckerWebpackPlugin({
    logger: 'webpack-infrastructure',
    typescript: {
      memoryLimit: 4096,
    },
  }),
  new webpack.DefinePlugin({
    'process.env.CONVEX_URL': JSON.stringify(resolvedConvexUrl),
    'process.env.WEB_APP_URL': JSON.stringify(resolvedWebAppUrl),
    // Don't define NODE_ENV here - webpack sets it automatically
  }),
];
