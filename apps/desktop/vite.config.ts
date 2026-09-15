import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Vite config for Present's frontend, served to the Tauri shell.
 *
 * It replaced the Electron build's Webpack config, which is gone with Electron
 * (tag `electron-final`); the notes on each block say what it kept.
 */

const DEFAULT_CONVEX_URL = "https://wary-iguana-735.convex.cloud";
const DEFAULT_WEB_APP_URL = "https://present.multivrs.space";

export default defineConfig(({ mode }) => {
  // `.env.local` in development and `.env.production` for a build, as the
  // Webpack config loaded them. Vite resolves both from `mode`.
  const env = loadEnv(mode, __dirname, "");
  const convexUrl = env.CONVEX_URL?.trim() || DEFAULT_CONVEX_URL;
  const webAppUrl = env.WEB_APP_URL?.trim() || DEFAULT_WEB_APP_URL;

  return {
    root: __dirname,
    // Tauri serves the bundle from the app root, so assets must be relative.
    base: "./",
    plugins: [react(), tailwindcss()],

    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        "@present/backend": path.resolve(__dirname, "../../packages/backend"),
        // Same single-instance guard Webpack applies; two React copies inside a
        // workspace produce "Invalid hook call".
        react: path.dirname(require.resolve("react/package.json")),
        "react-dom": path.dirname(require.resolve("react-dom/package.json")),
      },
    },

    define: {
      // The renderer reads these three at build time (DefinePlugin parity).
      "process.env.CONVEX_URL": JSON.stringify(convexUrl),
      "process.env.WEB_APP_URL": JSON.stringify(webAppUrl),
      "process.env.NODE_ENV": JSON.stringify(
        mode === "production" ? "production" : "development",
      ),
    },

    build: {
      outDir: "dist-tauri",
      emptyOutDir: true,
      target: "es2022",
      sourcemap: mode !== "production",
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "index.html"),
          output: path.resolve(__dirname, "output.html"),
          splash: path.resolve(__dirname, "splash.html"),
        },
      },
    },

    // Tauri drives this dev server; a fixed port keeps `devUrl` honest and
    // `strictPort` makes a port clash fail loudly instead of silently serving
    // the wrong app on the next port up.
    server: {
      port: 5173,
      strictPort: true,
      host: "127.0.0.1",
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },

    clearScreen: false,
    envPrefix: ["VITE_", "TAURI_ENV_"],
  };
});
