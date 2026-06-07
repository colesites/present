// Downloads the base.en whisper.cpp model into apps/desktop/.whisper/models
// for local development. The packaged app ships the model as a resource; this
// is only for `pnpm start` dev runs.
//
// Usage: node scripts/fetch-whisper-model.cjs

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const DEST_DIR = path.resolve(__dirname, "../.whisper/models");
const DEST = path.join(DEST_DIR, "ggml-base.en.bin");

function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          file.close();
          fs.rmSync(dest, { force: true });
          if (redirectsLeft <= 0) {
            reject(new Error("Too many redirects"));
            return;
          }
          resolve(download(res.headers.location, dest, redirectsLeft - 1));
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.rmSync(dest, { force: true });
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        const total = Number(res.headers["content-length"] ?? 0);
        let received = 0;
        res.on("data", (chunk) => {
          received += chunk.length;
          if (total > 0) {
            const pct = ((received / total) * 100).toFixed(0);
            process.stdout.write(`\r[whisper-model] ${pct}%`);
          }
        });
        res.pipe(file);
        file.on("finish", () => file.close(() => {
          process.stdout.write("\n");
          resolve();
        }));
      })
      .on("error", (error) => {
        file.close();
        fs.rmSync(dest, { force: true });
        reject(error);
      });
  });
}

async function main() {
  if (fs.existsSync(DEST)) {
    console.log(`[whisper-model] already present: ${DEST}`);
    return;
  }
  fs.mkdirSync(DEST_DIR, { recursive: true });
  console.log("[whisper-model] downloading ggml-base.en.bin (~142MB)…");
  await download(MODEL_URL, DEST);
  console.log(`[whisper-model] saved to ${DEST}`);
}

main().catch((error) => {
  console.error("[whisper-model] failed:", error.message);
  process.exit(1);
});
