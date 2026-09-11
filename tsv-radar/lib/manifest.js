// lib/manifest.js
// Loads manifest.json (human-friendly playlist config) and resolves it into
// the compact JSON the firmware consumes, plus the bitmap registry that maps
// page names → frame sets.

import fs from "fs";
import crypto from "crypto";
import { radar } from "./radar.js";
import { weather } from "./weather.js";
import { content, safeName } from "./content.js";
import { renderTextCard, pickQuote, message, messageActive, DEFAULT_QUOTES } from "./text.js";
import { sites as planeSites, ensureSite } from "./planes.js";

const MANIFEST_PATH = process.env.MANIFEST_PATH || "/mnt/data/manifest.json";

export const DEFAULT_MANIFEST = {
  defaults: {
    pollMs: 60000,
    tz: "AEST-10",
    bright: { day: 200, night: 26, nightStart: 22, nightEnd: 7 },
    ota: { enabled: false, auto: false, checkMs: 21600000, version: "", url: "" },
    quotes: DEFAULT_QUOTES,
    quoteRotateMinutes: 10,
    messageDurationMs: 8000,
  },
  pages: [
    { type: "RADAR", loops: 5, frameDelayMs: 450 },
    { type: "CLOCK", durationMs: 10000 },
    { type: "WEATHER", durationMs: 8000 },
    { type: "CLOCK", durationMs: 10000 },
    { type: "PLANES", durationMs: 9000 },
    { type: "QUOTE", durationMs: 7000 },
  ],
  devices: {},
};

export const manifestState = {
  path: MANIFEST_PATH,
  config: DEFAULT_MANIFEST,
  loadedAt: 0,
  lastError: null,
  mtimeMs: 0,
};

function posInt(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}
function nonNegInt(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

// Accept both the new nested `bright` block and the old flat keys.
function normaliseDefaults(d = {}) {
  const base = DEFAULT_MANIFEST.defaults;
  const bright = {
    day: posInt(d.bright?.day ?? d.brightDay, base.bright.day),
    night: posInt(d.bright?.night ?? d.brightNight, base.bright.night),
    nightStart: nonNegInt(d.bright?.nightStart ?? d.nightStartHour, base.bright.nightStart) % 24,
    nightEnd: nonNegInt(d.bright?.nightEnd ?? d.nightEndHour, base.bright.nightEnd) % 24,
  };
  return {
    pollMs: posInt(d.pollMs, base.pollMs),
    tz: String(d.tz || base.tz),
    bright,
    ota: {
      enabled: Boolean(d.ota?.enabled ?? false),
      auto: Boolean(d.ota?.auto ?? false),
      checkMs: posInt(d.ota?.checkMs, base.ota.checkMs),
      version: String(d.ota?.version ?? ""),
      url: String(d.ota?.url ?? ""),
    },
    quotes: Array.isArray(d.quotes) && d.quotes.length ? d.quotes.map(String) : base.quotes,
    quoteRotateMinutes: posInt(d.quoteRotateMinutes, base.quoteRotateMinutes),
    messageDurationMs: posInt(d.messageDurationMs, base.messageDurationMs),
  };
}

export function loadManifest(force = false) {
  try {
    if (!fs.existsSync(MANIFEST_PATH)) {
      manifestState.config = DEFAULT_MANIFEST;
      manifestState.lastError = null;
      manifestState.loadedAt = Date.now();
      return manifestState.config;
    }
    const st = fs.statSync(MANIFEST_PATH);
    if (!force && st.mtimeMs === manifestState.mtimeMs) return manifestState.config;
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    manifestState.config = {
      defaults: normaliseDefaults(parsed.defaults),
      pages: Array.isArray(parsed.pages) && parsed.pages.length ? parsed.pages : DEFAULT_MANIFEST.pages,
      devices: parsed.devices && typeof parsed.devices === "object" ? parsed.devices : {},
    };
    manifestState.mtimeMs = st.mtimeMs;
    manifestState.loadedAt = Date.now();
    manifestState.lastError = null;
  } catch (err) {
    manifestState.lastError = err.message;
    console.error("manifest.json load failed:", err.message);
  }
  return manifestState.config;
}

export function readRawManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return JSON.stringify(DEFAULT_MANIFEST, null, 2);
  return fs.readFileSync(MANIFEST_PATH, "utf8");
}

export function writeRawManifest(text) {
  const parsed = JSON.parse(text); // throws on invalid JSON
  if (!parsed || typeof parsed !== "object") throw new Error("manifest must be a JSON object");
  if (parsed.pages && !Array.isArray(parsed.pages)) throw new Error("pages must be an array");
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(parsed, null, 2) + "\n");
  loadManifest(true);
  return manifestState.config;
}

// ── bitmap registry ──────────────────────────────────────────────
const textCache = new Map(); // key -> { frames, at }

function renderCached(key, fn) {
  const hit = textCache.get(key);
  if (hit) return hit.frames;
  const frames = [fn().toRgb565BE()];
  if (textCache.size > 64) textCache.clear();
  textCache.set(key, { frames, at: Date.now() });
  return frames;
}

export function getBitmap(name, size = 64, deviceId = "default") {
  const n = safeName(name);
  const d = resolvedDefaults(deviceId);

  if (n === "radar") {
    return { name: n, frames: radar.frames.map((f) => f.buf), frameDelayMs: 450, updatedAt: radar.updatedAt };
  }
  if (n === "weather") {
    return { name: n, frames: weather.frames, frameDelayMs: weather.frameDelayMs, updatedAt: weather.updatedAt };
  }
  if (n.startsWith("planes")) {
    const site = planeSites.get(n);
    if (!site) return null;
    site.lastUsed = Date.now();
    return { name: n, frames: site.frames, frameDelayMs: 3000, updatedAt: site.updatedAt, text: site.data ? `${site.data.airborne} airborne` : "" };
  }
  if (n === "quote") {
    const q = pickQuote(d.quotes, d.quoteRotateMinutes * 60 * 1000);
    const frames = renderCached(`quote:${size}:${q.text}`, () => renderTextCard(q.text, { size }));
    return { name: n, frames, frameDelayMs: 7000, updatedAt: 0, text: q.text };
  }
  if (n === "message") {
    if (!messageActive()) return { name: n, frames: [], frameDelayMs: 0, updatedAt: 0 };
    const header = message.from ? `From ${message.from}` : "Message";
    const frames = renderCached(`msg:${size}:${message.setAt}:${message.text}`, () =>
      renderTextCard(message.text, { size, header })
    );
    return { name: n, frames, frameDelayMs: d.messageDurationMs, updatedAt: message.setAt, text: message.text };
  }
  const asset = content.assets.get(n);
  if (asset) {
    return { name: n, frames: asset.frames, frameDelayMs: asset.frameDelayMs, updatedAt: content.updatedAt };
  }
  return null;
}

// ── resolution for a device ──────────────────────────────────────
export function resolvedDefaults(deviceId = "default") {
  const cfg = manifestState.config;
  const dev = cfg.devices?.[deviceId] || {};
  const merged = { ...cfg.defaults, ...dev };
  if (dev.bright) merged.bright = { ...cfg.defaults.bright, ...dev.bright };
  if (dev.ota) merged.ota = { ...cfg.defaults.ota, ...dev.ota };
  return normaliseDefaults(merged);
}

export function resolveManifest(deviceId = "default", size = 64) {
  loadManifest();
  const cfg = manifestState.config;
  const d = resolvedDefaults(deviceId);
  const dev = cfg.devices?.[deviceId] || {};
  const srcPages = Array.isArray(dev.pages) && dev.pages.length ? dev.pages : cfg.pages;

  const pages = [];
  const skipped = [];
  for (const p of srcPages) {
    const t = String(p.type || "").toUpperCase();
    if (p.enabled === false) continue;

    if (t === "CLOCK") {
      pages.push({ type: "CLOCK", durationMs: posInt(p.durationMs, 10000) });
      continue;
    }
    if (t === "RADAR") {
      if (!radar.frames.length) {
        skipped.push({ type: t, reason: "no radar frames yet" });
        continue;
      }
      pages.push({ type: "BITMAP", name: "radar", loops: posInt(p.loops, 5), frameDelayMs: posInt(p.frameDelayMs, 450) });
      continue;
    }
    if (t === "WEATHER") {
      const n = weather.frames.length;
      if (!n) {
        skipped.push({ type: t, reason: "no weather data yet" });
        continue;
      }
      // animated icon: cycle the phase frames for roughly durationMs
      const durationMs = posInt(p.durationMs, 8000);
      const loops = Math.max(1, Math.round(durationMs / (n * weather.frameDelayMs)));
      pages.push({ type: "BITMAP", name: "weather", loops, frameDelayMs: weather.frameDelayMs });
      continue;
    }
    if (t === "PLANES") {
      const site = ensureSite({ lat: p.lat, lon: p.lon, radiusNm: p.radiusNm, label: p.label });
      if (!site.frames.length) {
        skipped.push({ type: t, reason: "no aircraft data yet" });
        continue;
      }
      const durationMs = posInt(p.durationMs, 9000);
      pages.push({ type: "BITMAP", name: site.name, loops: 1, frameDelayMs: Math.max(2000, Math.round(durationMs / site.frames.length)) });
      continue;
    }
    if (t === "QUOTE") {
      pages.push({ type: "BITMAP", name: "quote", loops: 1, frameDelayMs: posInt(p.durationMs, 7000) });
      continue;
    }
    if (t === "CONTENT") {
      const name = safeName(p.name);
      const asset = content.assets.get(name);
      if (!asset) {
        skipped.push({ type: t, name, reason: "no such content asset" });
        continue;
      }
      const page = { type: "BITMAP", name, loops: posInt(p.loops, 1), frameDelayMs: posInt(p.frameDelayMs, asset.frameDelayMs) };
      if (asset.frames.length <= 1) page.frameDelayMs = posInt(p.durationMs, 8000);
      pages.push(page);
      continue;
    }
    skipped.push({ type: t, reason: "unknown page type" });
  }

  // An active message is injected right after the first page of every cycle.
  if (messageActive()) {
    pages.splice(Math.min(1, pages.length), 0, { type: "BITMAP", name: "message", loops: 1, frameDelayMs: d.messageDurationMs });
  }

  if (!pages.length) pages.push({ type: "CLOCK", durationMs: 10000 });

  const body = {
    v: 2,
    deviceId,
    size,
    pollMs: d.pollMs,
    tz: d.tz,
    bright: d.bright,
    ota: d.ota,
    pages,
  };
  body.rev = crypto.createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 12);
  return { manifest: body, skipped };
}
