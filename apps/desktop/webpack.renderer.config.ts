import type { Configuration } from 'webpack';
import path from 'path';

import { createWebpackRules } from './webpack.rules';
import { createWebpackPlugins } from './webpack.plugins';

const rules = createWebpackRules();

rules.push({
  test: /\.css$/,
  use: [{ loader: 'style-loader' }, { loader: 'css-loader' }, { loader: 'postcss-loader' }],
});

export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  plugins: createWebpackPlugins(),
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
    conditionNames: ['import', 'module', 'browser', 'require', 'style'],
    fallback: {
      stream: false,
    },
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@present/backend': path.resolve(__dirname, '../../packages/backend'),
      'jszip$': require.resolve('jszip/lib/index.js'),
      // Ensure single React instance to prevent "Invalid hook call" errors
      'react': path.dirname(require.resolve('react/package.json')),
      'react-dom': path.dirname(require.resolve('react-dom/package.json')),
    },
  },
};
