// lib/pixel.js
// Tiny pixel-art toolkit for rendering 64x64 (or larger) RGB565 frames.
// Everything here is deliberately integer / nearest-neighbour so output is
// crisp on an LED matrix.

import sharp from "sharp";

// ── 5x7 font (Adafruit GFX classic glyphs), column-major, bit0 = top row ──
const FONT_5X7 = {
  " ": [0x00, 0x00, 0x00, 0x00, 0x00],
  "!": [0x00, 0x00, 0x5f, 0x00, 0x00],
  '"': [0x00, 0x07, 0x00, 0x07, 0x00],
  "#": [0x14, 0x7f, 0x14, 0x7f, 0x14],
  $: [0x24, 0x2a, 0x7f, 0x2a, 0x12],
  "%": [0x23, 0x13, 0x08, 0x64, 0x62],
  "&": [0x36, 0x49, 0x56, 0x20, 0x50],
  "'": [0x00, 0x08, 0x07, 0x03, 0x00],
  "(": [0x00, 0x1c, 0x22, 0x41, 0x00],
  ")": [0x00, 0x41, 0x22, 0x1c, 0x00],
  "*": [0x2a, 0x1c, 0x7f, 0x1c, 0x2a],
  "+": [0x08, 0x08, 0x3e, 0x08, 0x08],
  ",": [0x00, 0x80, 0x70, 0x30, 0x00],
  "-": [0x08, 0x08, 0x08, 0x08, 0x08],
  ".": [0x00, 0x00, 0x60, 0x60, 0x00],
  "/": [0x20, 0x10, 0x08, 0x04, 0x02],
  0: [0x3e, 0x51, 0x49, 0x45, 0x3e],
  1: [0x00, 0x42, 0x7f, 0x40, 0x00],
  2: [0x72, 0x49, 0x49, 0x49, 0x46],
  3: [0x21, 0x41, 0x49, 0x4d, 0x33],
  4: [0x18, 0x14, 0x12, 0x7f, 0x10],
  5: [0x27, 0x45, 0x45, 0x45, 0x39],
  6: [0x3c, 0x4a, 0x49, 0x49, 0x31],
  7: [0x41, 0x21, 0x11, 0x09, 0x07],
  8: [0x36, 0x49, 0x49, 0x49, 0x36],
  9: [0x46, 0x49, 0x49, 0x29, 0x1e],
  ":": [0x00, 0x00, 0x14, 0x00, 0x00],
  ";": [0x00, 0x40, 0x34, 0x00, 0x00],
  "<": [0x00, 0x08, 0x14, 0x22, 0x41],
  "=": [0x14, 0x14, 0x14, 0x14, 0x14],
  ">": [0x00, 0x41, 0x22, 0x14, 0x08],
  "?": [0x02, 0x01, 0x59, 0x09, 0x06],
  "@": [0x3e, 0x41, 0x5d, 0x59, 0x4e],
  A: [0x7c, 0x12, 0x11, 0x12, 0x7c],
  B: [0x7f, 0x49, 0x49, 0x49, 0x36],
  C: [0x3e, 0x41, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x41, 0x3e],
  E: [0x7f, 0x49, 0x49, 0x49, 0x41],
  F: [0x7f, 0x09, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x41, 0x51, 0x73],
  H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
  I: [0x00, 0x41, 0x7f, 0x41, 0x00],
  J: [0x20, 0x40, 0x41, 0x3f, 0x01],
  K: [0x7f, 0x08, 0x14, 0x22, 0x41],
  L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x1c, 0x02, 0x7f],
  N: [0x7f, 0x04, 0x08, 0x10, 0x7f],
  O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06],
  Q: [0x3e, 0x41, 0x51, 0x21, 0x5e],
  R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x26, 0x49, 0x49, 0x49, 0x32],
  T: [0x03, 0x01, 0x7f, 0x01, 0x03],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f],
  V: [0x1f, 0x20, 0x40, 0x20, 0x1f],
  W: [0x3f, 0x40, 0x38, 0x40, 0x3f],
  X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x03, 0x04, 0x78, 0x04, 0x03],
  Z: [0x61, 0x59, 0x49, 0x4d, 0x43],
  "[": [0x00, 0x7f, 0x41, 0x41, 0x41],
  "\\": [0x02, 0x04, 0x08, 0x10, 0x20],
  "]": [0x00, 0x41, 0x41, 0x41, 0x7f],
  "^": [0x04, 0x02, 0x01, 0x02, 0x04],
  _: [0x40, 0x40, 0x40, 0x40, 0x40],
  "`": [0x00, 0x03, 0x07, 0x08, 0x00],
  a: [0x20, 0x54, 0x54, 0x78, 0x40],
  b: [0x7f, 0x28, 0x44, 0x44, 0x38],
  c: [0x38, 0x44, 0x44, 0x44, 0x28],
  d: [0x38, 0x44, 0x44, 0x28, 0x7f],
  e: [0x38, 0x54, 0x54, 0x54, 0x18],
  f: [0x00, 0x08, 0x7e, 0x09, 0x02],
  g: [0x18, 0xa4, 0xa4, 0x9c, 0x78],
  h: [0x7f, 0x08, 0x04, 0x04, 0x78],
  i: [0x00, 0x44, 0x7d, 0x40, 0x00],
  j: [0x20, 0x40, 0x40, 0x3d, 0x00],
  k: [0x7f, 0x10, 0x28, 0x44, 0x00],
  l: [0x00, 0x41, 0x7f, 0x40, 0x00],
  m: [0x7c, 0x04, 0x78, 0x04, 0x78],
  n: [0x7c, 0x08, 0x04, 0x04, 0x78],
  o: [0x38, 0x44, 0x44, 0x44, 0x38],
  p: [0xfc, 0x18, 0x24, 0x24, 0x18],
  q: [0x18, 0x24, 0x24, 0x18, 0xfc],
  r: [0x7c, 0x08, 0x04, 0x04, 0x08],
  s: [0x48, 0x54, 0x54, 0x54, 0x24],
  t: [0x04, 0x04, 0x3f, 0x44, 0x24],
  u: [0x3c, 0x40, 0x40, 0x20, 0x7c],
  v: [0x1c, 0x20, 0x40, 0x20, 0x1c],
  w: [0x3c, 0x40, 0x30, 0x40, 0x3c],
  x: [0x44, 0x28, 0x10, 0x28, 0x44],
  y: [0x4c, 0x90, 0x90, 0x90, 0x7c],
  z: [0x44, 0x64, 0x54, 0x4c, 0x44],
  "{": [0x00, 0x08, 0x36, 0x41, 0x00],
  "|": [0x00, 0x00, 0x77, 0x00, 0x00],
  "}": [0x00, 0x41, 0x36, 0x08, 0x00],
  "~": [0x02, 0x01, 0x02, 0x04, 0x02],
  // degree sign: small ring in the top-left corner
  "°": [0x00, 0x06, 0x09, 0x09, 0x06],
};

// ── 3x5 micro font (uppercase + digits) for tight labels ─────────
// rows top→bottom, 3 bits each, MSB = left
const FONT_3X5 = {
  " ": [0, 0, 0, 0, 0],
  0: [7, 5, 5, 5, 7],
  1: [2, 6, 2, 2, 7],
  2: [7, 1, 7, 4, 7],
  3: [7, 1, 7, 1, 7],
  4: [5, 5, 7, 1, 1],
  5: [7, 4, 7, 1, 7],
  6: [7, 4, 7, 5, 7],
  7: [7, 1, 1, 1, 1],
  8: [7, 5, 7, 5, 7],
  9: [7, 5, 7, 1, 7],
  A: [2, 5, 7, 5, 5],
  B: [6, 5, 6, 5, 6],
  C: [3, 4, 4, 4, 3],
  D: [6, 5, 5, 5, 6],
  E: [7, 4, 6, 4, 7],
  F: [7, 4, 6, 4, 4],
  G: [3, 4, 5, 5, 3],
  H: [5, 5, 7, 5, 5],
  I: [7, 2, 2, 2, 7],
  J: [1, 1, 1, 5, 2],
  K: [5, 5, 6, 5, 5],
  L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5],
  N: [6, 5, 5, 5, 5],
  O: [2, 5, 5, 5, 2],
  P: [6, 5, 6, 4, 4],
  Q: [2, 5, 5, 6, 3],
  R: [6, 5, 6, 5, 5],
  S: [3, 4, 2, 1, 6],
  T: [7, 2, 2, 2, 2],
  U: [5, 5, 5, 5, 7],
  V: [5, 5, 5, 5, 2],
  W: [5, 5, 7, 7, 5],
  X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2],
  Z: [7, 1, 2, 4, 7],
  "-": [0, 0, 7, 0, 0],
  ".": [0, 0, 0, 0, 2],
  ":": [0, 2, 0, 2, 0],
  "%": [5, 1, 2, 4, 5],
  "/": [1, 1, 2, 4, 4],
  "°": [2, 5, 2, 0, 0],
  "+": [0, 2, 7, 2, 0],
  "!": [2, 2, 2, 0, 2],
  "?": [7, 1, 3, 0, 2],
  "'": [2, 2, 0, 0, 0],
  ",": [0, 0, 0, 2, 4],
};


// ── 5x8 BOLD font: every stroke is 2 px, so nothing on the panel is a single
//    pixel wide. Rows top→bottom, 5 bits each, MSB = left. Advance 6 px.
const FONT_BOLD = {
  " ": [0, 0, 0, 0, 0, 0, 0, 0],
  0: [31, 31, 27, 27, 27, 27, 31, 31],
  1: [6, 14, 6, 6, 6, 6, 15, 15],
  2: [31, 31, 3, 31, 31, 24, 31, 31],
  3: [31, 31, 3, 15, 15, 3, 31, 31],
  4: [27, 27, 27, 31, 31, 3, 3, 3],
  5: [31, 31, 24, 31, 31, 3, 31, 31],
  6: [31, 31, 24, 31, 31, 27, 31, 31],
  7: [31, 31, 3, 3, 3, 3, 3, 3],
  8: [31, 31, 27, 31, 31, 27, 31, 31],
  9: [31, 31, 27, 31, 31, 3, 31, 31],
  A: [14, 31, 27, 27, 31, 31, 27, 27],
  B: [30, 31, 27, 30, 30, 27, 31, 30],
  C: [31, 31, 24, 24, 24, 24, 31, 31],
  D: [30, 31, 27, 27, 27, 27, 31, 30],
  E: [31, 31, 24, 30, 30, 24, 31, 31],
  F: [31, 31, 24, 30, 30, 24, 24, 24],
  G: [31, 31, 24, 24, 27, 27, 31, 31],
  H: [27, 27, 27, 31, 31, 27, 27, 27],
  I: [31, 31, 12, 12, 12, 12, 31, 31],
  J: [3, 3, 3, 3, 3, 27, 31, 31],
  K: [27, 27, 30, 28, 28, 30, 27, 27],
  L: [24, 24, 24, 24, 24, 24, 31, 31],
  M: [27, 31, 31, 27, 27, 27, 27, 27],
  N: [30, 31, 27, 27, 27, 27, 27, 27],
  O: [31, 31, 27, 27, 27, 27, 31, 31],
  P: [31, 31, 27, 31, 31, 24, 24, 24],
  Q: [31, 31, 27, 27, 27, 31, 31, 3],
  R: [31, 31, 27, 31, 31, 30, 27, 27],
  S: [31, 31, 24, 31, 31, 3, 31, 31],
  T: [31, 31, 12, 12, 12, 12, 12, 12],
  U: [27, 27, 27, 27, 27, 27, 31, 31],
  V: [27, 27, 27, 27, 27, 27, 31, 14],
  W: [27, 27, 27, 27, 27, 31, 31, 27],
  X: [27, 27, 31, 14, 14, 31, 27, 27],
  Y: [27, 27, 27, 31, 31, 12, 12, 12],
  Z: [31, 31, 3, 14, 14, 24, 31, 31],
  ".": [0, 0, 0, 0, 0, 0, 12, 12],
  ",": [0, 0, 0, 0, 0, 12, 12, 24],
  ":": [0, 12, 12, 0, 0, 12, 12, 0],
  "-": [0, 0, 0, 31, 31, 0, 0, 0],
  "+": [0, 12, 12, 31, 31, 12, 12, 0],
  "°": [14, 31, 27, 31, 14, 0, 0, 0],
  "%": [25, 27, 3, 6, 12, 24, 27, 19],
  "/": [3, 3, 6, 6, 12, 12, 24, 24],
  "!": [12, 12, 12, 12, 12, 0, 12, 12],
  "?": [31, 31, 3, 14, 12, 0, 12, 12],
  "'": [12, 12, 0, 0, 0, 0, 0, 0],
  "&": [14, 27, 30, 12, 30, 27, 31, 15],
  "(": [6, 12, 24, 24, 24, 24, 12, 6],
  ")": [12, 6, 3, 3, 3, 3, 6, 12],
  "^": [4, 14, 27, 0, 0, 0, 0, 0],
  v: [0, 0, 0, 0, 0, 27, 14, 4],
  "=": [0, 0, 31, 31, 0, 31, 31, 0],
  "*": [0, 27, 14, 31, 14, 27, 0, 0],
};

// ── Colours ───────────────────────────────────────────────────────
export const C = {
  black: [0, 0, 0],
  white: [240, 240, 240],
  grey: [110, 110, 120],
  dim: [50, 50, 60],
  red: [227, 0, 15],
  blue: [0, 48, 135],
  sky: [40, 120, 255],
  yellow: [255, 221, 0],
  orange: [255, 120, 0],
  green: [30, 200, 80],
  cyan: [0, 200, 220],
  cloud: [200, 205, 215],
  cloudDark: [120, 125, 140],
  rain: [60, 140, 255],
  moon: [235, 235, 200],
  purple: [150, 60, 220],
};

export class Canvas {
  constructor(width, height, bg = C.black) {
    this.w = width;
    this.h = height;
    this.data = Buffer.alloc(width * height * 4);
    this.clear(bg);
  }

  clear(rgb = C.black) {
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = rgb[0];
      this.data[i + 1] = rgb[1];
      this.data[i + 2] = rgb[2];
      this.data[i + 3] = 255;
    }
  }

  set(x, y, rgb) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = rgb[0];
    this.data[i + 1] = rgb[1];
    this.data[i + 2] = rgb[2];
    this.data[i + 3] = 255;
  }

  rect(x, y, w, h, rgb) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, rgb);
  }

  // Rules are always 2 px: single-pixel lines look thin and broken on the panel.
  hline(x, y, w, rgb) {
    this.rect(x, y, w, 2, rgb);
  }

  vline(x, y, h, rgb) {
    this.rect(x, y, 2, h, rgb);
  }

  ring(cx, cy, r, rgb, thickness = 2) {
    for (let k = 0; k < thickness; k++) this.circle(cx, cy, r - k, rgb);
  }

  // filled disc
  disc(cx, cy, r, rgb) {
    for (let y = -r; y <= r; y++) {
      const half = Math.floor(Math.sqrt(r * r - y * y));
      this.rect(cx - half, cy + y, 2 * half + 1, 1, rgb);
    }
  }

  circle(cx, cy, r, rgb) {
    // midpoint circle
    let x = r, y = 0, err = 1 - r;
    while (x >= y) {
      this.set(cx + x, cy + y, rgb); this.set(cx + y, cy + x, rgb);
      this.set(cx - y, cy + x, rgb); this.set(cx - x, cy + y, rgb);
      this.set(cx - x, cy - y, rgb); this.set(cx - y, cy - x, rgb);
      this.set(cx + y, cy - x, rgb); this.set(cx + x, cy - y, rgb);
      y++;
      if (err < 0) err += 2 * y + 1;
      else { x--; err += 2 * (y - x) + 1; }
    }
  }

  line(x0, y0, x1, y1, rgb, thick = 2) {
    if (thick >= 2) {
      this.line(x0, y0, x1, y1, rgb, 1);
      const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
      if (dx >= dy) this.line(x0, y0 + 1, x1, y1 + 1, rgb, 1); else this.line(x0 + 1, y0, x1 + 1, y1, rgb, 1);
      return;
    }
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, rgb);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // 7-segment digit in a w×h cell — same geometry as the firmware's clock.
  sevenSeg(x, y, w, h, digit, rgb, strokeOverride = 0) {
    const MASK = [0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110, 0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111];
    const mask = digit === "-" ? 0b1000000 : MASK[Number(digit)] ?? 0;
    const m = Math.max(1, Math.floor(w / 10));
    const t = strokeOverride || Math.max(2, Math.floor(Math.min(w, h) / 7));
    const x0 = x + m, x1 = x + w - m, y0 = y + m, y1 = y + h - m;
    const mid = Math.floor((y0 + y1) / 2);
    const gOn = (mask & (1 << 6)) !== 0;
    const halfTop = Math.max(0, gOn ? mid - y0 - Math.floor(t / 2) : mid - y0);
    const halfBot = Math.max(0, gOn ? y1 - (mid + Math.floor(t / 2)) : y1 - mid);
    if (mask & (1 << 0)) this.rect(x0, y0, x1 - x0, t, rgb);                              // A
    if (mask & (1 << 6)) this.rect(x0, mid - Math.floor(t / 2), x1 - x0, t, rgb);         // G
    if (mask & (1 << 3)) this.rect(x0, y1 - t, x1 - x0, t, rgb);                          // D
    if (mask & (1 << 5)) this.rect(x0, y0, t, halfTop, rgb);                              // F
    if (mask & (1 << 4)) this.rect(x0, mid, t, halfBot, rgb);                             // E
    if (mask & (1 << 1)) this.rect(x1 - t, y0, t, halfTop, rgb);                          // B
    if (mask & (1 << 2)) this.rect(x1 - t, mid, t, halfBot, rgb);                         // C
  }

  // ── text ──
  static measure(text, { font = "bold", scale = 1, spacing = 1 } = {}) {
    const glyphW = font === "3x5" ? 3 : 5;
    const n = [...String(text)].length;
    if (n === 0) return 0;
    return (n * glyphW + (n - 1) * spacing) * scale;
  }

  text(x, y, str, rgb, { font = "bold", scale = 1, spacing = 1 } = {}) {
    const chars = [...String(str)];
    let cx = x;
    if (font === "bold") {
      for (const ch of chars) {
        const key = ch === "v" ? "v" : ch.toUpperCase();
        const g = FONT_BOLD[key] || FONT_BOLD["?"];
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 5; c++) {
            if (g[r] & (1 << (4 - c))) this.rect(cx + c * scale, y + r * scale, scale, scale, rgb);
          }
        }
        cx += (5 + spacing) * scale;
      }
      return cx;
    }
    if (font === "3x5") {
      for (const ch of chars) {
        const g = FONT_3X5[ch.toUpperCase()] || FONT_3X5["?"];
        for (let r = 0; r < 5; r++) {
          for (let c = 0; c < 3; c++) {
            if (g[r] & (1 << (2 - c))) this.rect(cx + c * scale, y + r * scale, scale, scale, rgb);
          }
        }
        cx += (3 + spacing) * scale;
      }
      return cx;
    }
    for (const ch of chars) {
      const g = FONT_5X7[ch] || FONT_5X7["?"];
      for (let c = 0; c < 5; c++) {
        for (let r = 0; r < 8; r++) {
          if (g[c] & (1 << r)) this.rect(cx + c * scale, y + r * scale, scale, scale, rgb);
        }
      }
      cx += (5 + spacing) * scale;
    }
    return cx;
  }

  textCentered(y, str, rgb, opts = {}) {
    const w = Canvas.measure(str, opts);
    return this.text(Math.floor((this.w - w) / 2), y, str, rgb, opts);
  }

  textRight(xRight, y, str, rgb, opts = {}) {
    const w = Canvas.measure(str, opts);
    return this.text(xRight - w, y, str, rgb, opts);
  }

  // Greedy word wrap into lines that fit maxWidth.
  static wrap(text, maxWidth, opts = {}) {
    const words = String(text).replace(/\s+/g, " ").trim().split(" ");
    const lines = [];
    let cur = "";
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (Canvas.measure(trial, opts) <= maxWidth) {
        cur = trial;
      } else {
        if (cur) lines.push(cur);
        // hard-break words that are too long on their own
        let piece = w;
        while (Canvas.measure(piece, opts) > maxWidth && piece.length > 1) {
          let k = piece.length - 1;
          while (k > 1 && Canvas.measure(piece.slice(0, k), opts) > maxWidth) k--;
          lines.push(piece.slice(0, k));
          piece = piece.slice(k);
        }
        cur = piece;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ── sprites: array of strings, one char per pixel, palette map ──
  sprite(x, y, rows, palette, scale = 1) {
    rows.forEach((row, ry) => {
      [...row].forEach((ch, rx) => {
        const rgb = palette[ch];
        if (!rgb) return;
        this.rect(x + rx * scale, y + ry * scale, scale, scale, rgb);
      });
    });
  }

  // ── output ──
  toRgb565BE() {
    return rgbaToRgb565BE(this.data);
  }

  async toPng(scale = 1) {
    return rgbaToPng(this.data, this.w, this.h, scale);
  }
}

// ── conversions ───────────────────────────────────────────────────
export function rgbaToRgb565BE(rawRgba) {
  const out = Buffer.alloc((rawRgba.length / 4) * 2);
  let o = 0;
  for (let i = 0; i < rawRgba.length; i += 4) {
    const v = ((rawRgba[i] & 0xf8) << 8) | ((rawRgba[i + 1] & 0xfc) << 3) | (rawRgba[i + 2] >> 3);
    out[o++] = v >> 8;
    out[o++] = v & 0xff;
  }
  return out;
}

export function rgb565BEToRgba(raw565, width, height) {
  const out = Buffer.alloc(width * height * 4);
  let o = 0;
  for (let i = 0; i < raw565.length; i += 2) {
    const v = (raw565[i] << 8) | raw565[i + 1];
    out[o++] = Math.round((((v >> 11) & 0x1f) * 255) / 31);
    out[o++] = Math.round((((v >> 5) & 0x3f) * 255) / 63);
    out[o++] = Math.round(((v & 0x1f) * 255) / 31);
    out[o++] = 255;
  }
  return out;
}

export async function rgbaToPng(rgba, width, height, scale = 1) {
  let img = sharp(rgba, { raw: { width, height, channels: 4 } });
  if (scale > 1) img = img.resize(width * scale, height * scale, { kernel: "nearest" });
  return img.png().toBuffer();
}

export async function rgb565ToPng(raw565, width, height, scale = 1) {
  return rgbaToPng(rgb565BEToRgba(raw565, width, height), width, height, scale);
}

// ── weather icons (16x16) ────────────────────────────────────────
// palette keys: Y sun, W cloud light, G cloud dark, B rain, L lightning,
//               M moon, F fog, S snow, . transparent
const PAL = {
  Y: C.yellow,
  O: C.orange,
  W: C.cloud,
  G: C.cloudDark,
  B: C.rain,
  L: C.yellow,
  M: C.moon,
  F: C.grey,
  S: C.white,
};

const ICONS = {
  sun: [
    ".......YY.......",
    ".......YY.......",
    "..YY...YY...YY..",
    "...YY.YYYY.YY...",
    "....YYYYYYYY....",
    ".....YYYYYY.....",
    "YY..YYYYYYYY..YY",
    "YY..YYYYYYYY..YY",
    ".....YYYYYY.....",
    "....YYYYYYYY....",
    "...YY.YYYY.YY...",
    "..YY...YY...YY..",
    ".......YY.......",
    ".......YY.......",
    "................",
    "................",
  ],
  sunShort: [
    "................",
    "................",
    ".......YY.......",
    "...YY.YYYY.YY...",
    "....YYYYYYYY....",
    ".....YYYYYY.....",
    "..YYYYYYYYYYYY..",
    "..YYYYYYYYYYYY..",
    ".....YYYYYY.....",
    "....YYYYYYYY....",
    "...YY.YYYY.YY...",
    ".......YY.......",
    "................",
    "................",
    "................",
    "................",
  ],
  partly: [
    "....YY..........",
    ".YY.YY.YY.......",
    "..YYYYYY........",
    "YYYYYYYYYY......",
    "YYYYYYYYYY......",
    "..YYYYYY.WWWW...",
    ".YY.YY..WWWWWWW.",
    "....YY.WWWWWWWWW",
    "......WWWWWWWWWW",
    "....WWWWWWWWWWWW",
    "....WWWWWWWWWWWW",
    "....WWWWWWWWWWWW",
    ".....WWWWWWWWWW.",
    "................",
    "................",
    "................",
  ],
  partlyShort: [
    "................",
    "....YY..........",
    "..YYYYYY........",
    ".YYYYYYYY.......",
    ".YYYYYYYY.......",
    "..YYYYYY.WWWW...",
    "....YY..WWWWWWW.",
    ".......WWWWWWWWW",
    "......WWWWWWWWWW",
    "....WWWWWWWWWWWW",
    "....WWWWWWWWWWWW",
    "....WWWWWWWWWWWW",
    ".....WWWWWWWWWW.",
    "................",
    "................",
    "................",
  ],
  partlyNight: [
    ".MMM............",
    ".MMMM...........",
    "..MMMM..........",
    "..MMMMM.........",
    "...MMMMMMWWWW...",
    "....MMMMWWWWWWW.",
    ".......WWWWWWWWW",
    "......WWWWWWWWWW",
    "....WWWWWWWWWWWW",
    "....WWWWWWWWWWWW",
    "....WWWWWWWWWWWW",
    ".....WWWWWWWWWW.",
    "................",
    "................",
    "................",
    "................",
  ],
  moon: [
    "................",
    ".....MMMM.......",
    "....MMMM........",
    "...MMMM.........",
    "..MMMMM.........",
    "..MMMMM.........",
    "..MMMMM.........",
    "..MMMMMM........",
    "...MMMMMM.......",
    "....MMMMMMM..MM.",
    ".....MMMMMMMMMM.",
    ".......MMMMMM...",
    "................",
    "................",
    "................",
    "................",
  ],
  cloud: [
    "................",
    "................",
    "......WWWW......",
    ".....WWWWWW.....",
    "..WWWWWWWWWWW...",
    ".WWWWWWWWWWWWW..",
    "WWWWWWWWWWWWWWW.",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    ".WWWWWWWWWWWWWW.",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  overcast: [
    "................",
    "......GGGG......",
    ".....GGGGGG.....",
    "..GGGGGGGGGGG...",
    ".GGGGGGGGGGGGG..",
    "GGGGGGGGGGGGGGG.",
    "GGGGGGGGGGGGGGGG",
    ".GGGGGGGGGGGGGG.",
    "................",
    "....WWWWWWWW....",
    "..WWWWWWWWWWWW..",
    ".WWWWWWWWWWWWWW.",
    ".WWWWWWWWWWWWWW.",
    "..WWWWWWWWWWWW..",
    "................",
    "................",
  ],
  rain: [
    "......GGGG......",
    ".....GGGGGG.....",
    "..GGGGGGGGGGG...",
    ".GGGGGGGGGGGGG..",
    "GGGGGGGGGGGGGGG.",
    "GGGGGGGGGGGGGGGG",
    ".GGGGGGGGGGGGGG.",
    "................",
    "..BB...BB...BB..",
    "..BB...BB...BB..",
    "................",
    ".....BB...BB....",
    ".....BB...BB....",
    "................",
    "..BB...BB...BB..",
    "..BB...BB...BB..",
  ],
  drizzle: [
    "................",
    "......WWWW......",
    ".....WWWWWW.....",
    "..WWWWWWWWWWW...",
    ".WWWWWWWWWWWWW..",
    "WWWWWWWWWWWWWWW.",
    ".WWWWWWWWWWWWWW.",
    "................",
    "...BB....BB.....",
    "...BB....BB.....",
    "................",
    "........BB....BB",
    "........BB....BB",
    "................",
    "...BB....BB.....",
    "...BB....BB.....",
  ],
  storm: [
    "......GGGG......",
    ".....GGGGGG.....",
    "..GGGGGGGGGGG...",
    ".GGGGGGGGGGGGG..",
    "GGGGGGGGGGGGGGG.",
    "GGGGGGGGGGGGGGGG",
    ".GGGGGGGGGGGGGG.",
    "......LLL.......",
    "..BB.LLL..BB....",
    "..BB.LLLLL.BB...",
    "......LLL.......",
    "....BBLL.BB.....",
    "....BBLL.BB.....",
    "......L.........",
    "..BB.....BB.....",
    "..BB.....BB.....",
  ],
  fog: [
    "................",
    "..FFFFFFFFFF....",
    "..FFFFFFFFFF....",
    "................",
    "....FFFFFFFFFFF.",
    "....FFFFFFFFFFF.",
    "................",
    ".FFFFFFFFFFF....",
    ".FFFFFFFFFFF....",
    "................",
    "....FFFFFFFFFF..",
    "....FFFFFFFFFF..",
    "................",
    "..FFFFFFFF......",
    "..FFFFFFFF......",
    "................",
  ],
  snow: [
    "......WWWW......",
    ".....WWWWWW.....",
    "..WWWWWWWWWWW...",
    ".WWWWWWWWWWWWW..",
    "WWWWWWWWWWWWWWW.",
    ".WWWWWWWWWWWWWW.",
    "................",
    "..SS....SS....SS",
    "..SS....SS....SS",
    "................",
    ".....SS....SS...",
    ".....SS....SS...",
    "................",
    "..SS....SS....SS",
    "..SS....SS....SS",
    "................",
  ],
  unknown: [
    "................",
    "....GGGGGGGG....",
    "...GGGGGGGGGG...",
    "...GGG....GGG...",
    "..........GGG...",
    "........GGGG....",
    ".......GGGG.....",
    "......GGG.......",
    "......GGG.......",
    "......GGG.......",
    "................",
    "................",
    "......GGG.......",
    "......GGG.......",
    "................",
    "................",
  ],
};

// 8x8 mini versions for forecast columns
const MINI = {
  sun: ["...Y....", ".Y.Y.Y..", "..YYY...", "Y.YYY.Y.", "..YYY...", ".Y.Y.Y..", "...Y....", "........"],
  moon: ["..MM....", ".MM.....", ".MM.....", ".MMM....", "..MMM.M.", "...MMMM.", "........", "........"],
  partly: [".Y.Y....", "..YY....", "Y.YY.WW.", "....WWWW", "...WWWWW", "..WWWWWW", "........", "........"],
  partlyNight: [".M......", ".MM.....", ".MMM.WW.", "..M.WWWW", "...WWWWW", "..WWWWWW", "........", "........"],
  cloud: ["........", "...WW...", ".WWWWWW.", "WWWWWWWW", "WWWWWWWW", ".WWWWWW.", "........", "........"],
  overcast: ["...GG...", ".GGGGGG.", "GGGGGGGG", ".GGGGGG.", "..WWWW..", ".WWWWWW.", "........", "........"],
  rain: ["...GG...", ".GGGGGG.", "GGGGGGGG", ".GGGGGG.", ".B..B..B", "B..B..B.", "........", "........"],
  drizzle: ["...WW...", ".WWWWWW.", "WWWWWWWW", ".WWWWWW.", ".B..B...", "...B..B.", "........", "........"],
  storm: ["...GG...", ".GGGGGG.", "GGGGGGGG", ".GGGGGG.", "...LL.B.", "..LL....", "B.L..B..", "........"],
  fog: ["........", ".FFFFFF.", "........", "FFFFFFF.", "........", ".FFFFFFF", "........", "........"],
  snow: ["...WW...", ".WWWWWW.", "WWWWWWWW", ".WWWWWW.", ".S..S..S", "........", "S..S..S.", "........"],
  unknown: ["..GGGG..", ".G....G.", "......G.", "....GG..", "...G....", "........", "...G....", "........"],
};

export function iconNames() {
  return Object.keys(ICONS);
}

// Animation phases (0..3) give each icon a little life: the sun pulses, rain
// and snow fall, storms flash, clouds drift, fog rolls, the moon twinkles.
export const ICON_PHASES = 4;

function shiftRow(row, d) {
  const n = row.length;
  if (d > 0) return (".".repeat(d) + row).slice(0, n);
  if (d < 0) return (row + ".".repeat(-d)).slice(-d, n - d);
  return row;
}

function animateIcon(name, rows, phase) {
  const p = ((phase % ICON_PHASES) + ICON_PHASES) % ICON_PHASES;
  const odd = p % 2 === 1;
  switch (name) {
    case "sun":
      return { rows: odd ? ICONS.sunShort : rows, dx: 0 };
    case "partly":
      return { rows: odd ? ICONS.partlyShort : rows, dx: 0 };
    case "rain":
    case "drizzle":
    case "snow": {
      // roll the precipitation rows (8..15) downward by p pixels
      const out = rows.slice();
      for (let i = 8; i < 16; i++) out[8 + ((i - 8 + p) % 8)] = rows[i];
      return { rows: out, dx: 0 };
    }
    case "storm": {
      const out = rows.map((r) => (p >= 2 ? r.replace(/L/g, ".") : r));
      for (let i = 8; i < 16; i++) out[8 + ((i - 8 + p) % 8)] = (p >= 2 ? rows[i].replace(/L/g, ".") : rows[i]);
      return { rows: out, dx: 0 };
    }
    case "cloud":
    case "overcast":
    case "partlyNight":
      return { rows, dx: [0, 1, 1, 0][p] };
    case "fog":
      return { rows: rows.map((r, i) => shiftRow(r, (i % 4 === 2 ? 1 : -1) * [0, 1, 1, 0][p])), dx: 0 };
    case "moon": {
      const out = rows.slice();
      const stars = [[13, 2], [3, 11], [14, 6], [2, 4]];
      const [sx, sy] = stars[p];
      out[sy] = out[sy].slice(0, sx) + "M" + out[sy].slice(sx + 1);
      return { rows: out, dx: 0 };
    }
    default:
      return { rows, dx: 0 };
  }
}

export function drawIcon(canvas, name, x, y, size = 16, phase = 0) {
  const base = size === 8 ? MINI[name] || MINI.unknown : ICONS[name] || ICONS.unknown;
  const { rows, dx } = size === 8 ? { rows: base, dx: 0 } : animateIcon(name, base, phase);
  canvas.sprite(x + dx, y, rows, PAL, 1);
}

// Map a WMO weather code (Open-Meteo) to an icon name + label.
export function wmoToIcon(code, isDay = true) {
  const n = Number(code);
  // labels are at most 10 characters: that is one line of the bold font
  if (n === 0) return { icon: isDay ? "sun" : "moon", label: "Clear" };
  if (n === 1) return { icon: isDay ? "sun" : "moon", label: "Fair" };
  if (n === 2) return { icon: isDay ? "partly" : "partlyNight", label: "Partly cld" };
  if (n === 3) return { icon: "overcast", label: "Overcast" };
  if (n === 45 || n === 48) return { icon: "fog", label: "Fog" };
  if (n >= 51 && n <= 57) return { icon: "drizzle", label: "Drizzle" };
  if (n >= 61 && n <= 67) return { icon: "rain", label: n >= 65 ? "Heavy rain" : "Rain" };
  if (n >= 71 && n <= 77) return { icon: "snow", label: "Snow" };
  if (n >= 80 && n <= 82) return { icon: "rain", label: "Showers" };
  if (n === 85 || n === 86) return { icon: "snow", label: "Snow shwrs" };
  if (n >= 95) return { icon: "storm", label: "Storms" };
  return { icon: "unknown", label: "Unknown" };
}

// Colour a temperature (°C) using only the clock's Mondrian palette.
export function tempColour(t) {
  if (t == null || Number.isNaN(t)) return C.grey;
  if (t <= 12) return C.sky;    // cold
  if (t <= 22) return C.white;  // mild
  if (t <= 31) return C.yellow; // warm
  return C.red;                 // hot
}
