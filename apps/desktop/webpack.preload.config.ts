import type { Configuration } from 'webpack';

import { rules } from './webpack.rules';

export const preloadConfig: Configuration = {
  target: 'electron-preload',
  module: {
    rules,
  },
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
  },
};
