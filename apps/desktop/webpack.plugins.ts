import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
import * as webpack from 'webpack';
import * as dotenv from 'dotenv';

const isProductionBuild = process.env.NODE_ENV === 'production';
const preferredEnvFile = isProductionBuild ? '.env.production' : '.env.local';
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

export const plugins = [
  new ForkTsCheckerWebpackPlugin({
    logger: 'webpack-infrastructure',
    typescript: {
      memoryLimit: 4096,
    },
  }),
  new webpack.DefinePlugin({
    'process.env.AUTH0_DOMAIN': JSON.stringify(process.env.AUTH0_DOMAIN),
    'process.env.AUTH0_CLIENT_ID': JSON.stringify(process.env.AUTH0_CLIENT_ID),
    'process.env.CONVEX_URL': JSON.stringify(process.env.CONVEX_URL),
    'process.env.CONVEX_DEPLOYMENT': JSON.stringify(process.env.CONVEX_DEPLOYMENT),
    'process.env.AI_GATEWAY_API_KEY': JSON.stringify(process.env.AI_GATEWAY_API_KEY),
    'process.env.BETTER_AUTH_URL': JSON.stringify(process.env.BETTER_AUTH_URL),
    'process.env.CONVEX_SITE_URL': JSON.stringify(process.env.CONVEX_SITE_URL),
  }),
];
