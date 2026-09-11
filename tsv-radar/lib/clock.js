// lib/clock.js
// Server-side twin of the firmware's Mondrian / Flux clock, used for the
// dashboard preview and for rendering contact sheets when tuning the layout.
// Keep GEOMETRY in sync with weatherclock.ino (drawClockDigits & friends).

import { Canvas, C } from "./pixel.js";

export const GEOMETRY = {
  weightNarrow: 40,  // relative width of a "1"
  weightWide: 100,   // every other digit
  marginX: 2,        // px each side of a digit inside its cell
  marginY: 2,        // px above/below a digit inside its row
  stroke: 6,         // minimum segment thickness (chosen from the 100-time review)
  strokeDiv: 0,      // if >0, stroke grows with digit width: max(stroke, drawnWidth / strokeDiv)
  oneStyle: "centered", // "centered" bar for 1s, or "seg" for classic right-side 1
  leadingZero: 0,    // 1 = always two hour digits (09:41), 0 = single digit spans the row (Flux)
  quirk: 1,          // 1 = interlocking stems: last hour digit 4/7/1 drops through the minute
                     //     row, first minute digit 4/1 rises through the hour row; rows squeeze
  stemGap: 3,        // px between an extended stem and the squeezed row
};

const RING = [C.red, C.blue, C.white, C.yellow];
const MASK = [0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110, 0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111];

function paletteFromRot(rot) {
  return {
    tl: RING[(0 - rot + 4) & 3],
    tr: RING[(1 - rot + 4) & 3],
    br: RING[(2 - rot + 4) & 3],
    bl: RING[(3 - rot + 4) & 3],
  };
}

function fillWipe(cv, x, y, w, h, top, bottom, yCut) {
  if (w <= 0 || h <= 0) return;
  const yEnd = y + h;
  if (yEnd <= yCut) cv.rect(x, y, w, h, top);
  else if (y >= yCut) cv.rect(x, y, w, h, bottom);
  else {
    cv.rect(x, y, w, yCut - y, top);
    cv.rect(x, yCut, w, yEnd - yCut, bottom);
  }
}

function drawDigit(cv, d, x, y, w, h, top, bottom, yCut, g) {
  const x0 = x + g.marginX, x1 = x + w - g.marginX;
  const t = Math.max(g.stroke, g.strokeDiv > 0 ? Math.floor((x1 - x0) / g.strokeDiv) : 0);
  const y0 = y + g.marginY, y1 = y + h - g.marginY;
  const mid = Math.floor((y0 + y1) / 2);

  if (d === 1 && g.oneStyle === "centered") {
    const bx = Math.floor((x0 + x1) / 2 - t / 2);
    fillWipe(cv, bx, y0, t, y1 - y0, top, bottom, yCut);
    return;
  }

  const mask = MASK[d] ?? 0;
  const gOn = (mask & (1 << 6)) !== 0;
  const halfTop = Math.max(0, gOn ? mid - y0 - Math.floor(t / 2) : mid - y0);
  const halfBot = Math.max(0, gOn ? y1 - (mid + Math.floor(t / 2)) : y1 - mid);
  if (mask & (1 << 0)) fillWipe(cv, x0, y0, x1 - x0, t, top, bottom, yCut);                       // A
  if (mask & (1 << 6)) fillWipe(cv, x0, mid - Math.floor(t / 2), x1 - x0, t, top, bottom, yCut);  // G
  if (mask & (1 << 3)) fillWipe(cv, x0, y1 - t, x1 - x0, t, top, bottom, yCut);                   // D
  if (mask & (1 << 5)) fillWipe(cv, x0, y0, t, halfTop, top, bottom, yCut);                       // F
  if (mask & (1 << 4)) fillWipe(cv, x0, mid, t, halfBot, top, bottom, yCut);                      // E
  if (mask & (1 << 1)) fillWipe(cv, x1 - t, y0, t, halfTop, top, bottom, yCut);                   // B
  if (mask & (1 << 2)) fillWipe(cv, x1 - t, mid, t, halfBot, top, bottom, yCut);                  // C
}

function layoutRow(digits, g, rx0 = 0, rx1 = 64) {
  const weights = digits.map((d) => (d === 1 ? g.weightNarrow : g.weightWide));
  const total = weights.reduce((a, b) => a + b, 0);
  const width = rx1 - rx0;
  let x = rx0;
  return digits.map((d, i) => {
    const w = i === digits.length - 1 ? rx1 - x : Math.floor((width * weights[i]) / total);
    const cell = { d, x, w };
    x += w;
    return cell;
  });
}

// x of the stem that can extend out of a cell: right stem for 4/7, the bar for a 1, left stem for 4.
function stemX(cell, g, side) {
  const t = g.stroke;
  const x0 = cell.x + g.marginX, x1 = cell.x + cell.w - g.marginX;
  if (cell.d === 1 && g.oneStyle === "centered") return Math.floor((x0 + x1) / 2 - t / 2);
  if (side === "right" && (cell.d === 4 || cell.d === 7)) return x1 - t;
  if (side === "left" && cell.d === 4) return x0;
  return null;
}

export function renderClock(hh, mm, ss, size = 64, geometry = {}) {
  const g = { ...GEOMETRY, ...geometry };
  const cv = new Canvas(size, size);
  const rowH = size / 2;
  const yCut = Math.max(0, Math.min(size, Math.floor(((ss + 1) * size) / 60)));
  const cur = paletteFromRot(mm & 3);
  const prev = paletteFromRot((mm + 3) & 3);

  const hours = hh < 10 && !g.leadingZero ? [hh] : [Math.floor(hh / 10), hh % 10];
  const minutes = [Math.floor(mm / 10), mm % 10];

  // Pass 1: lay both rows out at full width to find the stems that will extend.
  let hcells = layoutRow(hours, g, 0, size);
  let mcells = layoutRow(minutes, g, 0, size);
  const t = g.stroke;
  let descX = null, ascX = null;
  if (g.quirk) {
    descX = stemX(hcells[hcells.length - 1], g, "right"); // hour stem dropping down
    ascX = stemX(mcells[0], g, "left");                    // minute stem rising up
    // two extended 1s dissolve the rows into bars; keep only the top one
    if (hcells[hcells.length - 1].d === 1 && mcells[0].d === 1) ascX = null;
  }
  // Pass 2: squeeze each row away from the other's stem. Squeezing only moves
  // the hour stem right and the minute stem left, so the gaps stay safe.
  const hx0 = ascX != null ? ascX + t + g.stemGap : 0;
  const mx1 = descX != null ? descX - g.stemGap : size;
  hcells = layoutRow(hours, g, hx0, size);
  mcells = layoutRow(minutes, g, 0, mx1);

  const hLast = hcells[hcells.length - 1];
  const hColour = hcells.length === 1 ? [cur.tl, prev.tl] : [cur.tr, prev.tr];
  drawDigit(cv, hcells[0].d, hcells[0].x, 0, hcells[0].w, rowH, cur.tl, prev.tl, yCut, g);
  if (hcells[1]) drawDigit(cv, hcells[1].d, hcells[1].x, 0, hcells[1].w, rowH, cur.tr, prev.tr, yCut, g);
  drawDigit(cv, mcells[0].d, mcells[0].x, rowH, mcells[0].w, rowH, cur.bl, prev.bl, yCut, g);
  drawDigit(cv, mcells[1].d, mcells[1].x, rowH, mcells[1].w, rowH, cur.br, prev.br, yCut, g);

  // Extensions: continue the stems through the other row.
  if (descX != null) {
    const sx = stemX(hLast, g, "right");
    fillWipe(cv, sx, rowH - g.marginY, t, size - g.marginY - (rowH - g.marginY), hColour[0], hColour[1], yCut);
  }
  if (ascX != null) {
    const sx = stemX(mcells[0], g, "left");
    fillWipe(cv, sx, g.marginY, t, rowH + g.marginY - g.marginY, cur.bl, prev.bl, yCut);
  }
  return cv;
}

// Contact sheet: an array of [hh, mm, ss] laid out in a grid.
export function renderSheet(times, cols = 10, size = 64, gap = 2, geometry = {}, labels = false) {
  const rows = Math.ceil(times.length / cols);
  const labelH = labels ? 8 : 0;
  const cv = new Canvas(cols * (size + gap) + gap, rows * (size + gap + labelH) + gap, [24, 24, 28]);
  times.forEach(([hh, mm, ss], i) => {
    const tile = renderClock(hh, mm, ss, size, geometry);
    const ox = gap + (i % cols) * (size + gap), oy = gap + Math.floor(i / cols) * (size + gap + labelH);
    if (labels) {
      const t = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      cv.text(ox + Math.floor((size - Canvas.measure(t, { font: "3x5" })) / 2), oy + size + 2, t, [150, 150, 160], { font: "3x5" });
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const k = (y * size + x) * 4;
      cv.set(ox + x, oy + y, [tile.data[k], tile.data[k + 1], tile.data[k + 2]]);
    }
  });
  return cv;
}

// 100 representative times: every hour, lots of 1s, mixed seconds for the wipe.
export function sampleTimes() {
  const out = [];
  const curated = [
    [0, 0, 0], [0, 1, 10], [1, 1, 20], [1, 10, 30], [1, 11, 40], [2, 22, 50], [3, 33, 59], [4, 44, 5], [5, 55, 15], [6, 6, 25],
    [7, 17, 35], [8, 28, 45], [9, 39, 55], [9, 41, 0], [10, 0, 8], [10, 1, 16], [10, 10, 24], [10, 11, 32], [11, 0, 40], [11, 1, 48],
    [11, 10, 56], [11, 11, 3], [11, 59, 11], [12, 0, 19], [12, 12, 27], [12, 34, 35], [13, 13, 43], [13, 37, 51], [14, 14, 59], [14, 41, 7],
    [15, 15, 12], [15, 51, 22], [16, 16, 33], [17, 7, 44], [17, 17, 55], [18, 18, 6], [19, 19, 17], [20, 20, 28], [21, 1, 39], [21, 11, 50],
    [21, 21, 1], [22, 22, 12], [23, 23, 23], [23, 59, 59], [0, 10, 30], [1, 0, 45], [1, 21, 2], [2, 1, 14], [7, 1, 26], [8, 11, 38],
  ];
  out.push(...curated);
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  while (out.length < 100) out.push([rnd(24), rnd(60), rnd(60)]);
  return out;
}
