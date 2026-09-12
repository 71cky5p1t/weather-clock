// lib/countdown.js
// Days until an event, in the clock's own digits.

import { Canvas, C } from "./pixel.js";
import { paletteFromRot, drawDigitsRow } from "./clock-core.js";

const TZ = process.env.DISPLAY_TZ || "Australia/Brisbane";

function todayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// days from today to `date` (YYYY-MM-DD). Repeats yearly if `yearly`.
export function daysUntil(date, yearly = false) {
  const today = todayIso();
  let target = String(date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) return null;
  if (yearly) {
    target = `${today.slice(0, 4)}${target.slice(4)}`;
    if (target < today) target = `${Number(today.slice(0, 4)) + 1}${target.slice(4)}`;
  }
  const a = Date.UTC(...today.split("-").map((v, i) => Number(v) - (i === 1 ? 1 : 0)));
  const b = Date.UTC(...target.split("-").map((v, i) => Number(v) - (i === 1 ? 1 : 0)));
  return Math.round((b - a) / 86400000);
}

export function renderCountdown(days, label, size = 64) {
  const cv = new Canvas(size, size);
  const pal = paletteFromRot(days & 3);
  if (days <= 0) {
    cv.textCentered(6, "TODAY", C.yellow, { scale: 2 });
    cv.hline(8, 26, 48, C.yellow);
  } else {
    const digits = String(Math.min(999, days)).split("").map(Number);
    drawDigitsRow(cv, digits, 0, 32, size, [pal.tl, pal.tr, pal.br]);
  }
  cv.textCentered(34, days === 1 ? "DAY" : "DAYS", C.white, { scale: days <= 0 ? 1 : 2 });
  cv.hline(0, 52, size, C.dim);
  cv.textCentered(55, String(label || "").toUpperCase().slice(0, 10), C.grey);
  return cv;
}

export function countdownFrames(page, size = 64) {
  const days = daysUntil(page.date, page.yearly);
  if (days == null || days < 0) return [];
  return [renderCountdown(days, page.label, size).toRgb565BE()];
}
