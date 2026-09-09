import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Vite config for the Tauri build of Present.
 *
 * Electron continues to build the same `src/` tree through Webpack + Forge
 * (`webpack.renderer.config.ts`). Both bundlers coexist during the migration;
 * neither is allowed to change the other's inputs. Anything defined here must
 * mirror the Webpack behaviour it replaces — see the notes on each block.
 */

const DEFAULT_CONVEX_URL = "https://wary-iguana-735.convex.cloud";
const DEFAULT_WEB_APP_URL = "https://present.multivrs.space";

export default defineConfig(({ mode }) => {
  // Webpack loads `.env.local` for `start` and `.env.production` otherwise
  // (webpack.plugins.ts). Vite's own convention resolves the same two files
  // from `mode`, so `--mode production` picks up `.env.production`.
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
      // Kept separate from `.webpack/` and `out/` so an Electron build and a
      // Tauri build can sit side by side without clobbering each other.
      outDir: "dist-tauri",
      emptyOutDir: true,
      target: "es2022",
      sourcemap: mode !== "production",
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "index.html"),
          output: path.resolve(__dirname, "output.html"),
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
        ignored: ["**/src-tauri/**", "**/.webpack/**", "**/out/**"],
      },
    },

    clearScreen: false,
    envPrefix: ["VITE_", "TAURI_ENV_"],
  };
});
