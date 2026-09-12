// lib/planes.js
// Aircraft overhead, via adsb.lol (free, no key). Rendered as a little radar
// scope: home in the middle, planes as dots, nearest few called out below.

import { Canvas, C } from "./pixel.js";

const DEFAULT_LAT = Number(process.env.LAT || -19.26);
const DEFAULT_LON = Number(process.env.LON || 146.82);
const DEFAULT_RADIUS_NM = Number(process.env.PLANES_RADIUS_NM || 60);
const REFRESH_MS = Number(process.env.PLANES_REFRESH_SECONDS || 60) * 1000;
const MAX_CALLOUTS = 3;

// name -> site { name, label, lat, lon, radiusNm, data, frames, updatedAt, lastError, lastUsed }
export const sites = new Map();

function siteKey(lat, lon, radiusNm) {
  return `${lat.toFixed(3)},${lon.toFixed(3)},${radiusNm}`;
}

// Register (or fetch) a site. Pages with custom coordinates get their own name.
export function ensureSite({ lat, lon, radiusNm, label } = {}) {
  const la = Number.isFinite(Number(lat)) ? Number(lat) : DEFAULT_LAT;
  const lo = Number.isFinite(Number(lon)) ? Number(lon) : DEFAULT_LON;
  const r = Math.max(5, Math.min(250, Number(radiusNm) || DEFAULT_RADIUS_NM));
  const isDefault = la === DEFAULT_LAT && lo === DEFAULT_LON && r === DEFAULT_RADIUS_NM;
  const name = isDefault ? "planes" : `planes-${hashKey(siteKey(la, lo, r))}`;
  let site = sites.get(name);
  if (!site) {
    site = { name, label: String(label || "OVERHEAD").toUpperCase().slice(0, 10), lat: la, lon: lo, radiusNm: r, data: null, frames: [], updatedAt: 0, lastError: null, lastUsed: Date.now() };
    sites.set(name, site);
    refreshSite(site).catch(() => {});
  }
  if (label) site.label = String(label).toUpperCase().slice(0, 10);
  site.lastUsed = Date.now();
  return site;
}

function hashKey(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(36).slice(0, 6);
}

// ── fetch ────────────────────────────────────────────────────────
async function fetchAircraft(site) {
  const url = `https://api.adsb.lol/v2/point/${site.lat}/${site.lon}/${site.radiusNm}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { "user-agent": "weather-clock/2 (matrix display)" } });
  if (!res.ok) throw new Error(`adsb.lol HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json.ac) ? json.ac : [];
}

const KM_PER_DEG_LAT = 110.57;

function normalise(site, ac) {
  const cosLat = Math.cos((site.lat * Math.PI) / 180);
  const planes = ac
    .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon))
    .map((a) => {
      const dxKm = (a.lon - site.lon) * 111.32 * cosLat;
      const dyKm = (a.lat - site.lat) * KM_PER_DEG_LAT;
      const distKm = Math.hypot(dxKm, dyKm);
      const onGround = a.alt_baro === "ground";
      const altFt = onGround ? 0 : Number(a.alt_baro ?? a.alt_geom ?? NaN);
      return {
        hex: a.hex,
        callsign: String(a.flight || a.r || a.hex || "").trim().toUpperCase(),
        type: String(a.t || "").toUpperCase(),
        desc: a.desc || "",
        altFt: Number.isFinite(altFt) ? altFt : null,
        onGround,
        gsKt: Number.isFinite(a.gs) ? a.gs : null,
        track: Number.isFinite(a.track) ? a.track : null,
        dxKm,
        dyKm,
        distKm,
        bearing: ((Math.atan2(dxKm, dyKm) * 180) / Math.PI + 360) % 360,
      };
    })
    .sort((p, q) => Number(p.onGround) - Number(q.onGround) || p.distKm - q.distKm);
  return { count: planes.length, airborne: planes.filter((p) => !p.onGround).length, planes };
}

// ── render ───────────────────────────────────────────────────────
function fmtAlt(p) {
  if (p.onGround) return "GND";
  if (p.altFt == null) return "---";
  return p.altFt >= 10000 ? `FL${Math.round(p.altFt / 100)}` : `${Math.round(p.altFt / 100) * 100}FT`;
}

function compass(bearing) {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(bearing / 45) % 8];
}

export function renderPlanesFrame(site, d, highlightIdx, size = 64) {
  const cv = new Canvas(size, size);
  const cx = 32, cy = 29, R = 15;

  // header
  cv.text(1, 1, site.label.slice(0, 8), C.grey);
  cv.textRight(63, 1, String(d.airborne), C.yellow);
  cv.hline(0, 10, size, C.dim);

  // scope: two 2 px rings, north tick, home
  cv.ring(cx, cy, R, C.dim, 2);
  cv.ring(cx, cy, Math.round(R / 2), [30, 30, 36], 2);
  cv.rect(cx - 1, cy - R - 2, 2, 2, C.grey);
  cv.rect(cx - 1, cy - 1, 2, 2, C.yellow);

  const kmPerPx = (site.radiusNm * 1.852) / R;
  d.planes.forEach((p, i) => {
    if (p.distKm / kmPerPx > R) return;
    const px = Math.round(cx + p.dxKm / kmPerPx);
    const py = Math.round(cy - p.dyKm / kmPerPx);
    const hi = i === highlightIdx;
    const colour = p.onGround ? C.grey : hi ? C.white : C.red;
    if (hi && p.track != null) {
      const rad = (p.track * Math.PI) / 180;
      cv.line(px, py, px + Math.round(Math.sin(rad) * 6), py - Math.round(Math.cos(rad) * 6), C.sky, 2);
    }
    if (hi) cv.rect(px - 2, py - 2, 4, 4, colour); else cv.rect(px - 1, py - 1, 2, 2, colour);
  });

  // callout for the highlighted plane
  cv.hline(0, 45, size, C.dim);
  const p = d.planes[highlightIdx];
  if (!p) {
    cv.textCentered(51, "NO TRAFFIC", C.grey);
    return cv;
  }
  cv.text(1, 47, p.callsign.slice(0, 6), C.white);
  cv.textRight(63, 47, `${Math.min(999, Math.round(p.distKm))}KM`, C.grey);
  cv.text(1, 56, (p.type || "????").slice(0, 4), C.cyan);
  cv.textRight(63, 56, fmtAlt(p), p.onGround ? C.grey : C.yellow);
  return cv;
}

export function renderPlanesError(site, msg, size = 64) {
  const cv = new Canvas(size, size);
  cv.text(1, 1, site.label.slice(0, 8), C.grey);
  cv.hline(0, 10, size, C.dim);
  cv.ring(32, 29, 15, C.dim, 2);
  cv.rect(31, 28, 2, 2, C.yellow);
  cv.hline(0, 45, size, C.dim);
  cv.textCentered(51, "NO DATA", C.grey);
  return cv;
}

export async function refreshSite(site, size = 64) {
  try {
    const ac = await fetchAircraft(site);
    const d = normalise(site, ac);
    site.data = d;
    const n = Math.min(MAX_CALLOUTS, d.planes.length);
    site.frames = n
      ? Array.from({ length: n }, (_, i) => renderPlanesFrame(site, d, i, size).toRgb565BE())
      : [renderPlanesFrame(site, d, -1, size).toRgb565BE()];
    site.updatedAt = Date.now();
    site.lastError = null;
  } catch (err) {
    site.lastError = err.message;
    if (!site.frames.length) site.frames = [renderPlanesError(site, err.message, size).toRgb565BE()];
    throw err;
  }
}

export function startPlanesScheduler(size = 64) {
  ensureSite({}); // default site always exists
  const tick = async () => {
    for (const site of sites.values()) {
      // drop custom sites nobody has asked for in a day
      if (site.name !== "planes" && Date.now() - site.lastUsed > 24 * 3600 * 1000) { sites.delete(site.name); continue; }
      await refreshSite(site, size).catch((err) => console.error(`planes refresh failed (${site.name}):`, err.message));
    }
  };
  tick();
  setInterval(tick, REFRESH_MS);
}
