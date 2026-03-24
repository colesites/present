import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
import * as webpack from 'webpack';
import * as dotenv from 'dotenv';

// Load variables from .env.local
const envConfig = dotenv.config({ path: path.resolve(__dirname, './.env.local') });
if (envConfig.error) {
  console.warn('[Webpack Config] Warning: .env.local not found at root. Using shell environment.');
} else {
  console.log('[Webpack Config] Successfully loaded .env.local');
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
