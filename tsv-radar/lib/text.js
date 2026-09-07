// lib/text.js
// Server-rendered text pages: rotating quotes and ad-hoc messages.

import { Canvas, C } from "./pixel.js";

const PALETTES = [
  { accent: C.yellow, text: C.white },
  { accent: C.red, text: C.white },
  { accent: C.sky, text: C.white },
  { accent: C.green, text: C.white },
  { accent: C.cyan, text: C.white },
  { accent: C.orange, text: C.white },
];

function hashStr(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

// Pick the largest font that fits, then lay it out vertically centred.
export function renderTextCard(text, { size = 64, accent, colour, header, font } = {}) {
  const cv = new Canvas(size, size);
  const pal = PALETTES[hashStr(text) % PALETTES.length];
  const ac = accent || pal.accent;
  const tc = colour || pal.text;

  const top = header ? 9 : 3;
  const bottom = size - 3;
  const avail = bottom - top;
  const maxW = size - 4;

  const candidates = font
    ? [{ font, scale: 1 }]
    : [
        { font: "5x7", scale: 2, lineH: 17 },
        { font: "5x7", scale: 1, lineH: 9 },
        { font: "3x5", scale: 1, lineH: 7 },
      ];

  let chosen = null;
  for (const c of candidates) {
    const lineH = c.lineH || (c.font === "3x5" ? 7 : 9) * (c.scale || 1);
    const lines = Canvas.wrap(text, maxW, c);
    if (lines.length * lineH <= avail) {
      chosen = { ...c, lineH, lines };
      break;
    }
  }
  if (!chosen) {
    // Too long even for the tiny font: truncate.
    const c = candidates[candidates.length - 1];
    const lineH = c.lineH || 7;
    const lines = Canvas.wrap(text, maxW, c).slice(0, Math.floor(avail / lineH));
    const last = lines.length - 1;
    if (last >= 0) lines[last] = lines[last].slice(0, Math.max(0, lines[last].length - 1)) + "…";
    chosen = { ...c, lineH, lines };
  }

  if (header) {
    cv.textCentered(1, header.toUpperCase().slice(0, 15), C.grey, { font: "3x5" });
    cv.hline(0, 7, size, ac);
  } else {
    cv.hline(0, 0, size, ac);
  }
  cv.hline(0, size - 1, size, ac);

  const blockH = chosen.lines.length * chosen.lineH;
  let y = top + Math.floor((avail - blockH) / 2);
  for (const line of chosen.lines) {
    cv.textCentered(y, line, tc, chosen);
    y += chosen.lineH;
  }
  return cv;
}

// ── quotes ───────────────────────────────────────────────────────
export const DEFAULT_QUOTES = [
  "Stay curious.",
  "Make something today.",
  "Slow is smooth, smooth is fast.",
  "Drink some water.",
  "Go outside for a bit.",
  "Done is better than perfect.",
];

export function pickQuote(quotes, rotateMs) {
  const list = Array.isArray(quotes) && quotes.length ? quotes : DEFAULT_QUOTES;
  const idx = Math.floor(Date.now() / Math.max(1000, rotateMs)) % list.length;
  return { text: String(list[idx]), index: idx, total: list.length };
}

// ── messages (ephemeral, set from the dashboard) ─────────────────
export const message = {
  text: "",
  from: "",
  expiresAt: 0,
  setAt: 0,
};

export function setMessage(text, minutes = 10, from = "") {
  const clean = String(text || "").trim().slice(0, 200);
  if (!clean) {
    clearMessage();
    return message;
  }
  message.text = clean;
  message.from = String(from || "").trim().slice(0, 40);
  message.setAt = Date.now();
  message.expiresAt = Date.now() + Math.max(1, Math.min(24 * 60, Number(minutes) || 10)) * 60 * 1000;
  return message;
}

export function clearMessage() {
  message.text = "";
  message.from = "";
  message.expiresAt = 0;
  message.setAt = 0;
}

export function messageActive() {
  return Boolean(message.text) && Date.now() < message.expiresAt;
}
