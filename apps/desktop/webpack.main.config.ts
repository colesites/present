import type { Configuration } from 'webpack';
import path from 'path';

import { createWebpackRules } from './webpack.rules';
import { createWebpackPlugins } from './webpack.plugins';

export const mainConfig: Configuration = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/main/index.ts',
  // Put your normal webpack config below here
  module: {
    rules: createWebpackRules(),
  },
  plugins: createWebpackPlugins(),
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@present/backend': path.resolve(__dirname, '../../packages/backend'),
    },
  },
  // Native modules must NOT be bundled — they use `bindings` which resolves
  // .node files using __dirname relative to node_modules at runtime.
  externals: {
    grandi: 'commonjs grandi',
    grandiose: 'commonjs grandiose',
  },
};
