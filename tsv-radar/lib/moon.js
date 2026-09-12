// lib/moon.js
// Moon phase, computed locally (no API). Drawn for the southern hemisphere:
// a waxing moon is lit on the left, as it appears from Townsville.

import { Canvas, C } from "./pixel.js";

const SYNODIC = 29.530588853;
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0);
const SOUTHERN = (Number(process.env.LAT || -19.26)) < 0;

export function moonInfo(now = Date.now()) {
  const days = (now - REF_NEW_MOON) / 86400000;
  const phase = ((days / SYNODIC) % 1 + 1) % 1;           // 0 new, 0.5 full
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const age = phase * SYNODIC;
  let name;
  if (phase < 0.03 || phase > 0.97) name = ["NEW", "MOON"];
  else if (phase < 0.22) name = ["WAXING", "CRESCENT"];
  else if (phase < 0.28) name = ["FIRST", "QUARTER"];
  else if (phase < 0.47) name = ["WAXING", "GIBBOUS"];
  else if (phase < 0.53) name = ["FULL", "MOON"];
  else if (phase < 0.72) name = ["WANING", "GIBBOUS"];
  else if (phase < 0.78) name = ["LAST", "QUARTER"];
  else name = ["WANING", "CRESCENT"];
  const toFull = phase < 0.5 ? (0.5 - phase) * SYNODIC : (1.5 - phase) * SYNODIC;
  const toNew = (1 - phase) * SYNODIC;
  return { phase, illumination, age, name, toFull, toNew };
}

export function renderMoonCard(info, size = 64) {
  const cv = new Canvas(size, size);
  const cx = 32, cy = 17, r = 14;
  const k = Math.cos(2 * Math.PI * info.phase);   // 1 new .. -1 full .. 1
  const waxing = info.phase < 0.5;
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y));
    // dark disc first
    cv.rect(cx - half, cy + y, 2 * half + 1, 1, [28, 28, 34]);
    // lit span (northern-hemisphere convention), then mirrored for the south
    let x0, x1;
    if (waxing) { x0 = Math.round(half * k); x1 = half; } else { x0 = -half; x1 = Math.round(-half * k); }
    if (SOUTHERN) [x0, x1] = [-x1, -x0];
    if (x1 > x0) cv.rect(cx + x0, cy + y, x1 - x0 + 1, 1, C.moon);
  }

  cv.textCentered(35, info.name[0], C.white);
  cv.textCentered(45, info.name[1], C.white);
  cv.hline(0, 54, size, C.dim);
  cv.text(1, 56, `${Math.round(info.illumination * 100)}%`, C.yellow);
  const days = Math.round(info.phase < 0.47 || info.phase > 0.53 ? (info.phase < 0.5 ? info.toFull : info.toNew) : 0);
  const what = info.phase < 0.47 ? "FULL" : info.phase > 0.53 ? "NEW" : "";
  if (what) cv.textRight(63, 56, `${what} ${days}D`, C.grey);
  return cv;
}

export function moonFrames(size = 64) {
  return [renderMoonCard(moonInfo(), size).toRgb565BE()];
}
