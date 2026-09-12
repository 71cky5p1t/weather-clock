// lib/date.js
// A date page in the clock's language: the day as big 7-seg digits on top,
// the month underneath, weekday tucked along the bottom.

import { Canvas, C } from "./pixel.js";
import { paletteFromRot, drawDigitsRow } from "./clock-core.js";

const TZ = process.env.DISPLAY_TZ || "Australia/Brisbane";

export function todayParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "long", day: "numeric", month: "short" }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return { day: Number(get("day")), month: get("month").slice(0, 3).toUpperCase(), weekday: get("weekday").toUpperCase() };
}

export function renderDateCard({ day, month, weekday }, size = 64) {
  const cv = new Canvas(size, size);
  const pal = paletteFromRot(day & 3);

  // day digits: exactly the clock's digit engine, one row tall
  const digits = String(day).split("").map(Number);
  drawDigitsRow(cv, digits, 0, 32, size, [pal.tl, pal.tr]);

  // month, big
  cv.textCentered(35, month, C.white, { scale: 2 });

  // weekday, small
  cv.textCentered(55, weekday.slice(0, 10), C.grey);
  return cv;
}

export function dateFrames(size = 64) {
  return [renderDateCard(todayParts(), size).toRgb565BE()];
}
