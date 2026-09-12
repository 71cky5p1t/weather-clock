// lib/radar.js
// BoM radar fetch (anonymous FTP) + compositing onto the coastline background.

import ftp from "basic-ftp";
import sharp from "sharp";
import fs from "fs";
import { PassThrough } from "node:stream";
import { rgbaToRgb565BE, Canvas } from "./pixel.js";

const PRODUCT_ID = process.env.PRODUCT_ID || "IDR1064";
const NUM_FRAMES = Number(process.env.NUM_FRAMES || 6);
const BACKGROUND_PATH = process.env.BACKGROUND_PATH || "/mnt/data/IDR1064.background.jpg";
const DEBUG_DIR = process.env.DEBUG_DIR || "/tmp/bom-debug";
const DISPLAY_TZ = process.env.DISPLAY_TZ || "Australia/Brisbane";

fs.mkdirSync(DEBUG_DIR, { recursive: true });

export const radar = {
  updatedAt: 0,
  lastAttempt: 0,
  lastError: null,
  consecutiveFailures: 0,
  frames: [], // { i, ts, name, buf }
  refreshing: false,
  productId: PRODUCT_ID,
  morphExclude: [], // rects (timestamp box) the device swaps instantly instead of morphing
};

function fmtHHMM(tsSec) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: DISPLAY_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(tsSec * 1000));
}

function tintCoastlineRedInPlace(rgba) {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const lum = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
    if (lum < 8) continue;
    rgba[i] = Math.min(255, Math.round(lum));
    rgba[i + 1] = 0;
    rgba[i + 2] = 0;
    rgba[i + 3] = 255;
  }
}

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

// Collapse BoM's rainbow scale into blue (light) / yellow (moderate) / red (heavy).
function remapRadarPaletteInPlace(rgba) {
  const BLUE = [0, 0, 255];
  const YELLOW = [255, 255, 0];
  const RED = [255, 0, 0];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const { h, s, v } = rgbToHsv(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (v < 0.1) continue;
    const isNearWhite = s < 0.2 && v > 0.75;
    let base;
    if (isNearWhite || (h >= 160 && h <= 260)) base = BLUE;
    else if (h >= 50 && h <= 160) base = YELLOW;
    else base = RED;
    const shade = 0.35 + 0.65 * v;
    rgba[i] = Math.min(255, Math.round(base[0] * shade));
    rgba[i + 1] = Math.min(255, Math.round(base[1] * shade));
    rgba[i + 2] = Math.min(255, Math.round(base[2] * shade));
  }
}

function drawTimestampRGBA(buffer, width, height, text) {
  // bold 5x8 glyphs (2 px strokes) in a black box, top-right
  const cv = new Canvas(width, height);
  const w = Canvas.measure(text) + 4;
  const x = width - w - 1;
  radar.morphExclude = [{ x, y: 1, w, h: 12 }];
  cv.rect(x, 1, w, 12, [0, 0, 0]);
  cv.text(x + 2, 3, text, [255, 221, 0]);
  for (let py = 1; py < 13; py++) for (let px = x; px < x + w; px++) {
    const i = (py * width + px) * 4, j = i;
    buffer[i] = cv.data[j]; buffer[i + 1] = cv.data[j + 1]; buffer[i + 2] = cv.data[j + 2]; buffer[i + 3] = 255;
  }
}

export function parseBomTsFromName(name) {
  // IDR1064.T.202601120209.png -> YYYYMMDDHHMM (UTC)
  const s = name.split(".")[2] || "";
  const Y = Number(s.slice(0, 4));
  const M = Number(s.slice(4, 6)) - 1;
  const D = Number(s.slice(6, 8));
  const h = Number(s.slice(8, 10));
  const m = Number(s.slice(10, 12));
  return Math.floor(Date.UTC(Y, M, D, h, m, 0) / 1000);
}

async function fetchBomFrames() {
  const client = new ftp.Client(15000);
  client.ftp.verbose = false;
  try {
    await client.access({ host: "ftp.bom.gov.au", user: "anonymous", password: "guest", secure: false });
    await client.cd("/anon/gen/radar");
    const list = await client.list();
    const names = list
      .map((f) => f.name)
      .filter((n) => n.startsWith(`${PRODUCT_ID}.T.`) && n.endsWith(".png"))
      .sort()
      .slice(-NUM_FRAMES);

    if (!names.length) throw new Error(`no ${PRODUCT_ID} frames listed on BoM FTP`);

    const frames = [];
    for (const name of names) {
      const stream = new PassThrough();
      const chunks = [];
      stream.on("data", (c) => chunks.push(c));
      const ended = new Promise((resolve, reject) => {
        stream.on("end", resolve);
        stream.on("error", reject);
      });
      await client.downloadTo(stream, name);
      await ended;
      frames.push({ name, buffer: Buffer.concat(chunks) });
    }
    return frames;
  } finally {
    client.close();
  }
}

let bgCache = null;
async function loadBackground(size) {
  if (bgCache && bgCache.size === size) return bgCache.data;
  const bg = await sharp(BACKGROUND_PATH).resize(size, size).ensureAlpha().raw().toBuffer();
  tintCoastlineRedInPlace(bg);
  // thicken the coastline to 2 px (dilate right and down)
  const src = Buffer.from(bg);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    if (src[i] < 40) continue;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx >= size || yy >= size) continue;
      const j = (yy * size + xx) * 4;
      if (bg[j] < src[i]) { bg[j] = src[i]; bg[j + 1] = 0; bg[j + 2] = 0; bg[j + 3] = 255; }
    }
  }
  bgCache = { size, data: bg };
  return bg;
}

async function buildRadarFrame(frame, index, size) {
  const bg = await loadBackground(size);

  let img = sharp(frame.buffer).ensureAlpha();
  const meta = await img.metadata();
  // BoM transparencies carry a 20px legend strip along the top
  img = img.extract({ left: 0, top: 20, width: meta.width, height: meta.height - 20 });
  const radarRgba = await img.resize(size, size).raw().toBuffer();
  remapRadarPaletteInPlace(radarRgba);

  // how many pixels carry a rain echo (used to decide whether to show the page)
  let echoPx = 0;
  for (let i = 0; i < radarRgba.length; i += 4) {
    if (radarRgba[i + 3] > 0 && (radarRgba[i] + radarRgba[i + 1] + radarRgba[i + 2]) > 60) echoPx++;
  }

  const out = Buffer.from(bg);
  for (let i = 0; i < out.length; i += 4) {
    const a = radarRgba[i + 3] / 255;
    if (a === 0) continue;
    out[i] = radarRgba[i] * a + out[i] * (1 - a);
    out[i + 1] = radarRgba[i + 1] * a + out[i + 1] * (1 - a);
    out[i + 2] = radarRgba[i + 2] * a + out[i + 2] * (1 - a);
    out[i + 3] = 255;
  }

  drawTimestampRGBA(out, size, size, fmtHHMM(parseBomTsFromName(frame.name)));

  sharp(out, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toFile(`${DEBUG_DIR}/frame_${index}.png`)
    .catch(() => {});

  return { buf: rgbaToRgb565BE(out), echoPx };
}

export async function refreshRadar(size = 64) {
  if (radar.refreshing) return;
  radar.refreshing = true;
  radar.lastAttempt = Date.now();
  try {
    const raw = await fetchBomFrames();
    // skip the expensive rebuild if BoM has nothing newer
    const newest = raw[raw.length - 1]?.name;
    const have = radar.frames[radar.frames.length - 1]?.name;
    if (newest && newest === have && raw.length === radar.frames.length) {
      radar.lastError = null;
      radar.consecutiveFailures = 0;
      return;
    }
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const { buf, echoPx } = await buildRadarFrame(raw[i], i, size);
      out.push({ i, ts: parseBomTsFromName(raw[i].name), name: raw[i].name, buf, echoPx });
    }
    radar.frames = out;
    radar.updatedAt = Date.now();
    radar.lastError = null;
    radar.consecutiveFailures = 0;
  } catch (err) {
    radar.lastError = err.message;
    radar.consecutiveFailures += 1;
    throw err;
  } finally {
    radar.refreshing = false;
  }
}

// Refresh on an interval, with quick retries after a failure (BoM FTP is flaky).
export function startRadarScheduler(size, refreshSeconds) {
  const baseMs = refreshSeconds * 1000;
  const schedule = (ms) => setTimeout(tick, ms);
  const tick = async () => {
    try {
      await refreshRadar(size);
      schedule(baseMs);
    } catch (err) {
      console.error("radar refresh failed:", err.message);
      const backoff = Math.min(baseMs, 30000 * 2 ** Math.min(radar.consecutiveFailures - 1, 4));
      schedule(backoff);
    }
  };
  tick();
}

// Rain echo pixels in the newest frame (0 when the scan is clear).
export function radarEchoPx() {
  const last = radar.frames[radar.frames.length - 1];
  return last ? last.echoPx : 0;
}

export function radarAgeSeconds() {
  const last = radar.frames[radar.frames.length - 1];
  if (!last) return null;
  return Math.round(Date.now() / 1000 - last.ts);
}

export { DEBUG_DIR };
