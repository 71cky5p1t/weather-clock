// lib/sun.js
// Daylight arc: sunrise to sunset with the sun's current position, from the
// Open-Meteo daily data the weather module already fetches.

import { Canvas, C } from "./pixel.js";
import { weather } from "./weather.js";

const TZ = process.env.DISPLAY_TZ || "Australia/Brisbane";

function localNowMs() {
  // "now" expressed on the same wall-clock scale as the ISO sunrise/sunset strings
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
  return (get("hour") % 24) * 3600000 + get("minute") * 60000 + get("second") * 1000;
}
const isoToMs = (iso) => { const m = /T(\d{2}):(\d{2})/.exec(iso || ""); return m ? Number(m[1]) * 3600000 + Number(m[2]) * 60000 : null; };
const hhmm = (iso) => (iso ? iso.slice(11, 16) : "--:--");
const dur = (ms) => { const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000); return `${h}H${String(m).padStart(2, "0")}`; };

export function renderSunCard(size = 64) {
  const cv = new Canvas(size, size);
  const today = weather.data?.days?.[0];
  const rise = isoToMs(today?.sunrise), set = isoToMs(today?.sunset);
  if (rise == null || set == null) {
    cv.textCentered(28, "NO SUN", C.grey);
    cv.textCentered(38, "DATA", C.grey);
    return cv;
  }
  const now = localNowMs();

  // rise / set times with accent bars
  cv.text(1, 1, hhmm(today.sunrise), C.yellow);
  cv.rect(1, 10, 29, 2, C.yellow);
  cv.textRight(63, 1, hhmm(today.sunset), C.orange);
  cv.rect(34, 10, 29, 2, C.orange);

  // arc
  const cx = 32, cy = 46, R = 24;
  for (let a = 0; a <= 180; a += 2) {
    const rad = (a * Math.PI) / 180;
    const x = Math.round(cx - R * Math.cos(rad)), y = Math.round(cy - R * Math.sin(rad));
    cv.rect(x, y, 2, 2, C.dim);
  }
  cv.rect(4, cy, 56, 2, C.dim);   // horizon

  const f = (now - rise) / (set - rise);
  const day = f >= 0 && f <= 1;
  if (day) {
    const rad = f * Math.PI;
    const x = Math.round(cx - R * Math.cos(rad)), y = Math.round(cy - R * Math.sin(rad));
    cv.disc(x + 1, y + 1, 3, C.yellow);
  } else {
    // night: moon sits under the horizon at the matching position
    const g = ((now - set + 86400000) % 86400000) / ((rise - set + 86400000) % 86400000);
    const rad = g * Math.PI;
    const x = Math.round(cx - R * Math.cos(rad)), y = Math.round(cy + R * Math.sin(rad) * 0.35);
    cv.disc(x + 1, y + 1, 3, C.moon);
  }

  const daylight = set - rise;
  let line;
  if (day) line = `SET ${dur(set - now)}`;
  else line = `RISE ${dur((rise - now + 86400000) % 86400000)}`;
  cv.textCentered(55, line, C.white);
  cv.text(1, 14, dur(daylight), C.grey);
  return cv;
}

export function sunFrames(size = 64) {
  return [renderSunCard(size).toRgb565BE()];
}
