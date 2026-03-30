import type { Configuration } from 'webpack';

import { createWebpackRules } from './webpack.rules';

export const preloadConfig: Configuration = {
  target: 'electron-preload',
  module: {
    rules: createWebpackRules(),
  },
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
  },
};
