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

// Pick the largest size that fits, then lay it out vertically centred.
// Returns the lines plus the x/y of every word so callers can light words
// up individually.
export function layoutTextCard(text, { size = 64, header } = {}) {
  const top = header ? 14 : 4;
  const bottom = size - 4;
  const avail = bottom - top;
  const maxW = size - 2;

  const candidates = [
    { scale: 2, lineH: 18 },
    { scale: 1, lineH: 10 },
  ];
  let chosen = null;
  for (const c of candidates) {
    const lines = Canvas.wrap(text, maxW, c);
    if (lines.length * c.lineH - 2 <= avail) { chosen = { ...c, lines }; break; }
  }
  if (!chosen) {
    const c = candidates[candidates.length - 1];
    const lines = Canvas.wrap(text, maxW, c).slice(0, Math.floor(avail / c.lineH));
    const last = lines.length - 1;
    if (last >= 0) lines[last] = lines[last].slice(0, Math.max(0, lines[last].length - 1)) + "-";
    chosen = { ...c, lines };
  }

  const blockH = chosen.lines.length * chosen.lineH - 2;
  let y = top + Math.floor((avail - blockH) / 2);
  const words = [];
  const spaceW = Canvas.measure(" ", chosen);
  for (const line of chosen.lines) {
    let x = Math.floor((size - Canvas.measure(line, chosen)) / 2);
    for (const w of line.split(" ")) {
      if (w) words.push({ text: w, x, y });
      x += Canvas.measure(w, chosen) + spaceW;
    }
    y += chosen.lineH;
  }
  return { ...chosen, words };
}

function scaleColour([r, g, b], a) {
  return [Math.round(r * a), Math.round(g * a), Math.round(b * a)];
}

// One card: the whole text, or the first `lit` words with the next `fading`
// words at brightness `alpha`.
function drawCard(text, { size = 64, accent, colour, header } = {}, layout, lit = Infinity, fading = 0, alpha = 1) {
  const cv = new Canvas(size, size);
  const pal = PALETTES[hashStr(text) % PALETTES.length];
  const ac = accent || pal.accent;
  const tc = colour || pal.text;

  // Messages get a header with a rule under it; quotes are just the words.
  if (header) {
    cv.textCentered(1, header.toUpperCase().slice(0, 10), C.grey);
    cv.hline(0, 10, size, ac);
  }
  layout.words.forEach((w, i) => {
    const c = i < lit ? tc : i < lit + fading ? scaleColour(tc, alpha) : null;
    if (c) cv.text(w.x, w.y, w.text, c, layout);
  });
  return cv;
}

export function renderTextCard(text, opts = {}) {
  return drawCard(text, opts, layoutTextCard(text, opts));
}

// ── word-by-word fade for quotes ─────────────────────────────────
// The board plays at most MAX_QUOTE_FRAMES frames per page, so short quotes
// get a few brightness steps per word and long ones reveal a word (or a
// couple) per frame.
export const MAX_QUOTE_FRAMES = 24;   // firmware MAX_FRAMES_T
const WORD_MS = 350;                  // time each word takes to arrive

export function quoteTiming(text, { size = 64 } = {}) {
  const words = layoutTextCard(text, { size }).words.length || 1;
  const group = Math.ceil(words / MAX_QUOTE_FRAMES);          // words revealed together
  const units = Math.ceil(words / group);
  const steps = Math.max(1, Math.min(4, Math.floor(MAX_QUOTE_FRAMES / units)));
  return { words, group, units, steps, frames: units * steps, stepMs: Math.max(60, Math.round((WORD_MS * group) / steps)) };
}

export function renderQuoteFrames(text, opts = {}) {
  const layout = layoutTextCard(text, opts);
  const t = quoteTiming(text, opts);
  const frames = [];
  for (let u = 0; u < t.units; u++) {
    for (let s = 1; s <= t.steps; s++) {
      const alpha = s / t.steps;
      frames.push(alpha >= 1 ? drawCard(text, opts, layout, (u + 1) * t.group) : drawCard(text, opts, layout, u * t.group, t.group, alpha * alpha));
    }
  }
  return frames;
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
