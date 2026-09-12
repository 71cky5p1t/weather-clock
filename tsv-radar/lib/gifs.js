// lib/gifs.js
// GIF player: picks a random GIF from CONTENT_DIR/gifs (and, if GIPHY_API_KEY
// is set, from a small auto-refreshed Giphy cache). GIFs are scored on how
// dark their border is; light backgrounds are rejected because they glare
// on the panel.

import fs from "fs";
import path from "path";
import sharp from "sharp";
import { buildContentAsset, safeName } from "./content.js";

const CONTENT_DIR = process.env.CONTENT_DIR || "/mnt/data/content";
const GIF_DIR = path.join(CONTENT_DIR, "gifs");
const GIPHY_KEY = process.env.GIPHY_API_KEY || "";
const GIPHY_QUERIES = (process.env.GIPHY_QUERIES || "pixel art,8bit,retro game,pixel loop").split(",").map((s) => s.trim()).filter(Boolean);
const GIPHY_DIR = path.join(GIF_DIR, ".giphy");
const GIPHY_MAX = 30;
const DARK_MIN = Number(process.env.GIF_DARK_MIN || 0.85);

fs.mkdirSync(GIF_DIR, { recursive: true });

export const gifs = {
  assets: new Map(), // name -> asset (+ score)
  rejected: [],
  updatedAt: 0,
  refreshing: false,
  current: null,
  currentAt: 0,
  lastError: null,
  dir: GIF_DIR,
  giphy: Boolean(GIPHY_KEY),
};

// fraction of border pixels that are near black (transparent counts as black)
async function darkBorderScore(file) {
  const rgba = await sharp(file, { animated: false }).flatten({ background: "#000" }).resize(32, 32, { fit: "fill" }).raw().toBuffer();
  let dark = 0, total = 0;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    if (x > 1 && x < 30 && y > 1 && y < 30) continue;
    const i = (y * 32 + x) * 3;
    total++;
    if (rgba[i] + rgba[i + 1] + rgba[i + 2] < 120) dark++;
  }
  return dark / total;
}

async function scanDir(dir, size, next, prefix) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(gif|webp)$/i.test(f)) continue;
    const full = path.join(dir, f);
    const name = `gif-${prefix}${safeName(path.parse(f).name)}`;
    const prev = gifs.assets.get(name);
    const mtimeMs = fs.statSync(full).mtimeMs;
    if (prev && prev.mtimeMs === mtimeMs) { next.set(name, prev); continue; }
    try {
      const score = await darkBorderScore(full);
      if (score < DARK_MIN) { gifs.rejected.push({ file: f, score: Number(score.toFixed(2)) }); continue; }
      const asset = await buildContentAsset(full, name, size);
      next.set(name, { ...asset, score, file: f });
    } catch (err) {
      console.error(`gif build failed for ${f}:`, err.message);
    }
  }
}

export async function refreshGifs(size = 64) {
  if (gifs.refreshing) return;
  gifs.refreshing = true;
  try {
    gifs.rejected = [];
    const next = new Map();
    await scanDir(GIF_DIR, size, next, "");
    await scanDir(GIPHY_DIR, size, next, "giphy-");
    gifs.assets = next;
    gifs.updatedAt = Date.now();
    gifs.lastError = null;
  } catch (err) {
    gifs.lastError = err.message;
  } finally {
    gifs.refreshing = false;
  }
}

// Pull a few GIFs from Giphy into the cache (only when a key is configured).
export async function refreshGiphy() {
  if (!GIPHY_KEY) return;
  fs.mkdirSync(GIPHY_DIR, { recursive: true });
  try {
    const q = GIPHY_QUERIES[Math.floor(Math.random() * GIPHY_QUERIES.length)];
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(GIPHY_KEY)}&q=${encodeURIComponent(q)}&limit=10&offset=${Math.floor(Math.random() * 100)}&rating=g&bundle=messaging_non_clips`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`giphy HTTP ${res.status}`);
    const json = await res.json();
    for (const g of json.data || []) {
      const src = g.images?.fixed_height_small?.url || g.images?.downsized?.url;
      if (!src) continue;
      const file = path.join(GIPHY_DIR, `${safeName(g.id)}.gif`);
      if (fs.existsSync(file)) continue;
      const r = await fetch(src, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    }
    // cap the cache
    const files = fs.readdirSync(GIPHY_DIR).map((f) => ({ f, t: fs.statSync(path.join(GIPHY_DIR, f)).mtimeMs })).sort((a, b) => a.t - b.t);
    while (files.length > GIPHY_MAX) fs.unlinkSync(path.join(GIPHY_DIR, files.shift().f));
    gifs.lastError = null;
  } catch (err) {
    gifs.lastError = `giphy: ${err.message}`;
    console.error("giphy refresh failed:", err.message);
  }
}

// Random pick, sticky for 15 s so the meta + frame fetches of one visit agree.
export function pickGif() {
  const list = Array.from(gifs.assets.values());
  if (!list.length) return null;
  if (gifs.current && gifs.assets.has(gifs.current.name) && Date.now() - gifs.currentAt < 15000) return gifs.current;
  let choice = list[Math.floor(Math.random() * list.length)];
  if (list.length > 1 && gifs.current && choice.name === gifs.current.name) choice = list[(list.indexOf(choice) + 1) % list.length];
  gifs.current = choice;
  gifs.currentAt = Date.now();
  return choice;
}

export function startGifScheduler(size = 64) {
  const tick = () => refreshGifs(size).catch((err) => console.error("gif refresh failed:", err.message));
  refreshGiphy().then(tick, tick);
  setInterval(tick, 5 * 60 * 1000);
  if (GIPHY_KEY) setInterval(() => refreshGiphy().then(tick), 60 * 60 * 1000);
}
