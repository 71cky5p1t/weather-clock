// lib/content.js
// User-supplied images / GIFs in CONTENT_DIR, converted to RGB565 frame sets.

import sharp from "sharp";
import fs from "fs";
import path from "path";
import { rgbaToRgb565BE } from "./pixel.js";

const CONTENT_DIR = process.env.CONTENT_DIR || "/mnt/data/content";
const MAX_CONTENT_FRAMES = Number(process.env.MAX_CONTENT_FRAMES || 12);

fs.mkdirSync(CONTENT_DIR, { recursive: true });

export const content = {
  updatedAt: 0,
  assets: new Map(), // name -> { name, sourceFile, frameDelayMs, frames[], mtimeMs }
  refreshing: false,
  dir: CONTENT_DIR,
};

export function safeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
}

function coercePosInt(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

async function buildContentAsset(filePath, assetName, size) {
  const meta = await sharp(filePath, { animated: true }).metadata();
  const pages = Math.max(1, Number(meta.pages || 1));
  const delays = Array.isArray(meta.delay) ? meta.delay.map((d) => coercePosInt(d, 120)) : [coercePosInt(meta.delay, 120)];

  // If a GIF has more frames than the device can hold, sample evenly.
  const take = Math.min(pages, MAX_CONTENT_FRAMES);
  const step = pages / take;

  const frames = [];
  for (let k = 0; k < take; k++) {
    const i = Math.floor(k * step);
    const rgba = await sharp(filePath, { animated: true })
      .extractFrame(i)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
      .ensureAlpha()
      .raw()
      .toBuffer();
    frames.push(rgbaToRgb565BE(rgba));
  }

  return {
    name: assetName,
    sourceFile: path.basename(filePath),
    frameDelayMs: Math.round(coercePosInt(delays[0], 120) * step),
    frames,
    mtimeMs: fs.statSync(filePath).mtimeMs,
  };
}

export async function refreshContent(size = 64) {
  if (content.refreshing) return;
  content.refreshing = true;
  try {
    const files = fs
      .readdirSync(CONTENT_DIR, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .filter((n) => /\.(png|jpg|jpeg|gif|webp)$/i.test(n));

    const next = new Map();
    for (const file of files) {
      const assetName = safeName(path.parse(file).name);
      const fullPath = path.join(CONTENT_DIR, file);
      const prev = content.assets.get(assetName);
      try {
        const mtimeMs = fs.statSync(fullPath).mtimeMs;
        if (prev && prev.mtimeMs === mtimeMs && prev.sourceFile === file) {
          next.set(assetName, prev); // unchanged, keep cached frames
          continue;
        }
        next.set(assetName, await buildContentAsset(fullPath, assetName, size));
      } catch (err) {
        console.error(`content build failed for ${file}:`, err.message);
      }
    }
    content.assets = next;
    content.updatedAt = Date.now();
  } finally {
    content.refreshing = false;
  }
}

export function startContentScheduler(size) {
  const tick = () => refreshContent(size).catch((err) => console.error("content refresh failed:", err.message));
  tick();
  setInterval(tick, 60 * 1000);
}
