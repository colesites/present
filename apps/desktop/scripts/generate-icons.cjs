// Generates all desktop launcher icons from the master SVG mark.
//   - macOS:   assets/icons/present.icns  (via iconutil, needs macOS)
//   - Windows: assets/icons/present.ico   (PNG-embedded, hand-built)
//   - Linux:   assets/icons/present.png   (1024px)
//
// Usage: node scripts/generate-icons.cjs
// Requires: sharp (already a workspace dep). iconutil/sips are macOS-only;
// the .icns step is skipped with a warning on other platforms.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const sharp = require("sharp");

const DESKTOP_DIR = path.resolve(__dirname, "..");
const SVG_PATH = path.resolve(DESKTOP_DIR, "../web/public/present-mark.svg");
const ICONS_DIR = path.resolve(DESKTOP_DIR, "assets/icons");

const renderPng = (size) =>
  sharp(SVG_PATH, { density: 512 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

async function writeLinuxPng() {
  const buf = await renderPng(1024);
  fs.writeFileSync(path.join(ICONS_DIR, "present.png"), buf);
  console.log("[icons] wrote present.png (1024)");
}

// --- Windows .ico (PNG-embedded; supported by Vista+ and Electron/Squirrel) ---
async function writeIco() {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(
    sizes.map(async (size) => ({ size, data: await renderPng(size) })),
  );

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 => 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8); // size of image data
    entry.writeUInt32LE(offset, 12); // offset
    offset += data.length;
    entries.push(entry);
  }

  const ico = Buffer.concat([
    header,
    ...entries,
    ...images.map((image) => image.data),
  ]);
  fs.writeFileSync(path.join(ICONS_DIR, "present.ico"), ico);
  console.log("[icons] wrote present.ico (16–256)");
}

// --- macOS .icns (iconutil) ---
async function writeIcns() {
  if (process.platform !== "darwin") {
    console.warn("[icons] skipping present.icns (iconutil is macOS-only)");
    return;
  }
  const iconset = fs.mkdtempSync(path.join(os.tmpdir(), "present-iconset-")) + ".iconset";
  fs.mkdirSync(iconset, { recursive: true });
  const variants = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];
  for (const [size, name] of variants) {
    fs.writeFileSync(path.join(iconset, name), await renderPng(size));
  }
  execFileSync("iconutil", [
    "-c",
    "icns",
    iconset,
    "-o",
    path.join(ICONS_DIR, "present.icns"),
  ]);
  fs.rmSync(iconset, { recursive: true, force: true });
  console.log("[icons] wrote present.icns");
}

async function main() {
  if (!fs.existsSync(SVG_PATH)) {
    throw new Error(`Master SVG not found: ${SVG_PATH}`);
  }
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  await writeLinuxPng();
  await writeIco();
  await writeIcns();
  console.log("[icons] done");
}

main().catch((error) => {
  console.error("[icons] failed:", error);
  process.exit(1);
});
