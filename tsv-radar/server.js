// server.js
// Content server for the LED matrix weather clock.
//  - BoM radar loop (lib/radar.js)
//  - Open-Meteo weather cards (lib/weather.js)
//  - user images / GIFs (lib/content.js)
//  - quotes + ad-hoc messages (lib/text.js)
//  - manifest-driven playlist per device (lib/manifest.js)
//  - dashboard at /

import express from "express";
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

import { rgb565ToPng } from "./lib/pixel.js";
import { radar, refreshRadar, startRadarScheduler, radarAgeSeconds, DEBUG_DIR } from "./lib/radar.js";
import { weather, refreshWeather, startWeatherScheduler } from "./lib/weather.js";
import { content, refreshContent, startContentScheduler, safeName } from "./lib/content.js";
import { message, messageActive, setMessage, clearMessage } from "./lib/text.js";
import { heartbeat, listDevices } from "./lib/devices.js";
import {
  manifestState,
  loadManifest,
  readRawManifest,
  writeRawManifest,
  resolveManifest,
  resolvedDefaults,
  getBitmap,
} from "./lib/manifest.js";

sharp.cache(false);
sharp.concurrency(1);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8787);
const SIZE = Number(process.env.SIZE || 64);
const REFRESH_SECONDS = Number(process.env.REFRESH_SECONDS || 600);
const FIRMWARE_DIR = process.env.FIRMWARE_DIR || "/mnt/data/firmware";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ""; // optional: protect write endpoints
const STARTED_AT = Date.now();

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Optional write protection. If ADMIN_TOKEN is set, mutating requests need
// header `x-admin-token: <token>` (or ?token=).
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const t = req.get("x-admin-token") || req.query.token;
  if (t === ADMIN_TOKEN) return next();
  res.status(401).json({ ok: false, error: "admin token required" });
}

function clientIp(req) {
  return (req.get("x-forwarded-for") || req.socket.remoteAddress || "").split(",")[0].trim();
}

// ── schedulers ─────────────────────────────────────────
loadManifest(true);
startRadarScheduler(SIZE, REFRESH_SECONDS);
startWeatherScheduler(SIZE);
startContentScheduler(SIZE);
setInterval(() => loadManifest(), 15 * 1000);

// ── firmware-facing API ────────────────────────────────
app.get("/api/manifest", (req, res) => {
  const deviceId = safeName(req.query.deviceId || "default") || "default";
  const { manifest } = resolveManifest(deviceId, SIZE);
  res.set("Cache-Control", "no-store").json(manifest);
});

app.get("/api/bitmap/:name", (req, res) => {
  const bm = getBitmap(req.params.name, SIZE, safeName(req.query.deviceId || "default"));
  if (!bm) return res.status(404).json({ error: "no such bitmap" });
  res.set("Cache-Control", "no-store").json({
    name: bm.name,
    count: bm.frames.length,
    frameDelayMs: bm.frameDelayMs,
    width: SIZE,
    height: SIZE,
    bytesPerFrame: SIZE * SIZE * 2,
    updatedAt: bm.updatedAt,
    text: bm.text,
  });
});

app.get("/api/bitmap/:name/:i.bin", (req, res) => {
  const bm = getBitmap(req.params.name, SIZE, safeName(req.query.deviceId || "default"));
  const i = Number(req.params.i);
  if (!bm) return res.status(404).send("no such bitmap");
  if (!Number.isInteger(i) || i < 0 || i >= bm.frames.length) return res.status(404).send("bad index");
  res.set("Cache-Control", "no-store").type("application/octet-stream").send(bm.frames[i]);
});

app.get("/api/bitmap/:name/:i.png", async (req, res) => {
  const bm = getBitmap(req.params.name, SIZE, safeName(req.query.deviceId || "default"));
  const i = Number(req.params.i);
  if (!bm) return res.status(404).send("no such bitmap");
  if (!Number.isInteger(i) || i < 0 || i >= bm.frames.length) return res.status(404).send("bad index");
  const scale = Math.max(1, Math.min(8, Number(req.query.scale) || 1));
  res.set("Cache-Control", "no-store").type("png").send(await rgb565ToPng(bm.frames[i], SIZE, SIZE, scale));
});

app.post("/api/device/heartbeat", (req, res) => {
  const body = req.body || {};
  const id = safeName(body.deviceId || req.query.deviceId || "");
  if (!id) return res.status(400).json({ ok: false, error: "deviceId required" });
  const rec = heartbeat(id, body, clientIp(req));
  const { manifest } = resolveManifest(id, SIZE);
  res.json({ ok: true, serverTime: Date.now(), manifestRev: manifest.rev, seen: rec.lastSeen });
});

// ── dashboard / admin API ──────────────────────────────
app.get("/api/status", (req, res) => {
  const deviceId = safeName(req.query.deviceId || "default") || "default";
  const { manifest, skipped } = resolveManifest(deviceId, SIZE);
  const quote = getBitmap("quote", SIZE, deviceId);
  res.set("Cache-Control", "no-store").json({
    now: Date.now(),
    uptimeS: Math.round((Date.now() - STARTED_AT) / 1000),
    size: SIZE,
    radar: {
      productId: radar.productId,
      count: radar.frames.length,
      updatedAt: radar.updatedAt,
      lastAttempt: radar.lastAttempt,
      lastError: radar.lastError,
      consecutiveFailures: radar.consecutiveFailures,
      ageS: radarAgeSeconds(),
      frames: radar.frames.map((f) => ({ i: f.i, ts: f.ts })),
    },
    weather: {
      updatedAt: weather.updatedAt,
      lastError: weather.lastError,
      count: weather.frames.length,
      data: weather.data,
    },
    content: Array.from(content.assets.values()).map((a) => ({
      name: a.name,
      sourceFile: a.sourceFile,
      count: a.frames.length,
      frameDelayMs: a.frameDelayMs,
    })),
    contentDir: content.dir,
    quote: quote?.text || "",
    message: messageActive() ? { ...message, remainingS: Math.round((message.expiresAt - Date.now()) / 1000) } : null,
    manifest,
    skipped,
    manifestPath: manifestState.path,
    manifestError: manifestState.lastError,
    defaults: resolvedDefaults(deviceId),
    deviceIds: Object.keys(manifestState.config.devices || {}),
    devices: listDevices(),
    adminProtected: Boolean(ADMIN_TOKEN),
  });
});

app.get("/api/weather", (req, res) => {
  res.set("Cache-Control", "no-store").json({ updatedAt: weather.updatedAt, lastError: weather.lastError, ...weather.data });
});

app.get("/api/devices", (req, res) => res.json(listDevices()));

app.get("/api/message", (req, res) => {
  res.json(messageActive() ? { active: true, ...message } : { active: false });
});
app.post("/api/message", requireAdmin, (req, res) => {
  const { text, minutes, from } = req.body || {};
  const m = setMessage(text, minutes, from);
  res.json({ active: messageActive(), ...m });
});
app.delete("/api/message", requireAdmin, (req, res) => {
  clearMessage();
  res.json({ active: false });
});

app.get("/api/manifest/config", (req, res) => {
  res.set("Cache-Control", "no-store").type("application/json").send(readRawManifest());
});
app.put("/api/manifest/config", requireAdmin, express.text({ type: "*/*", limit: "256kb" }), (req, res) => {
  try {
    const text = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    writeRawManifest(text);
    res.json({ ok: true, loadedAt: manifestState.loadedAt });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/admin/refresh-radar", requireAdmin, async (req, res) => {
  try {
    await refreshRadar(SIZE);
    res.json({ ok: true, count: radar.frames.length });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});
app.post("/api/admin/refresh-weather", requireAdmin, async (req, res) => {
  try {
    await refreshWeather(SIZE);
    res.json({ ok: true, data: weather.data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});
app.post("/api/admin/reload-content", requireAdmin, async (req, res) => {
  try {
    await refreshContent(SIZE);
    res.json({ ok: true, count: content.assets.size });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use("/firmware", express.static(FIRMWARE_DIR, { fallthrough: true }));

// ── legacy endpoints (kept for the original firmware) ──
app.get("/frames", (req, res) => {
  res.json({ updatedAt: radar.updatedAt, count: radar.frames.length, frames: radar.frames.map((f) => ({ i: f.i, ts: f.ts })) });
});
app.get("/latest.bin", (req, res) => {
  if (!radar.frames.length) return res.status(503).send("No data");
  res.type("application/octet-stream").send(radar.frames[radar.frames.length - 1].buf);
});
app.get("/frame/:i.bin", (req, res) => {
  const i = Number(req.params.i);
  if (!Number.isInteger(i) || i < 0 || i >= radar.frames.length) return res.status(404).send("Bad index");
  res.type("application/octet-stream").send(radar.frames[i].buf);
});
app.get("/viz/:i.png", async (req, res) => {
  const i = Number(req.params.i);
  if (!Number.isInteger(i) || i < 0 || i >= radar.frames.length) return res.status(404).send("Bad index");
  res.type("png").send(await rgb565ToPng(radar.frames[i].buf, SIZE, SIZE));
});
app.get("/debug/:n.png", (req, res) => res.sendFile(`${DEBUG_DIR}/frame_${Number(req.params.n) || 0}.png`));
app.get("/manifest", (req, res) => res.redirect(307, `/api/manifest?deviceId=${encodeURIComponent(req.query.deviceId || "default")}`));
app.get("/content", (req, res) => {
  res.json({
    updatedAt: content.updatedAt,
    count: content.assets.size,
    assets: Array.from(content.assets.values()).map((a) => ({ name: a.name, sourceFile: a.sourceFile, frameDelayMs: a.frameDelayMs, count: a.frames.length })),
  });
});
app.post("/admin/reload-content", (req, res) => res.redirect(307, "/api/admin/reload-content"));

app.listen(PORT, () => {
  console.log(`weather clock server on :${PORT}  (matrix ${SIZE}x${SIZE})`);
  console.log(`manifest: ${manifestState.path}`);
  console.log(`content:  ${content.dir}`);
});
