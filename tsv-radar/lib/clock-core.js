// lib/clock-core.js
// The Mondrian / Flux clock, environment-agnostic: runs in Node (server
// previews) and in the browser (clock lab). Draws onto anything with
// rect(x, y, w, h, [r,g,b]). Mirrors weatherclock.ino drawClockDigits.

export const GEOMETRY = {
  weightNarrow: 40,  // relative width of a "1"
  weightWide: 100,   // every other digit
  marginX: 2,        // px each side of a digit inside its cell
  marginY: 2,        // px above/below a digit inside its row
  stroke: 6,         // segment thickness (chosen from the 100-time review)
  oneStyle: "centered", // "centered" bar for 1s, or "seg" for classic right-side 1
  leadingZero: 0,    // 1 = always two hour digits (09:41), 0 = single digit spans the row (Flux)
  quirk: 1,          // 1 = interlocking stems: last hour digit 4/7/1 drops through the minute
                     //     row, first minute digit 4 rises through the hour row; rows squeeze
  oneRises: 0,       // 1 = a minute-tens "1" also rises through the hour row. Off by default:
                     //     the free-standing bar reads as a leading hour digit (04:10 looks like 14:10)
  stemGap: 3,        // px between an extended stem and the squeezed row
  minHole: 3,        // px of daylight a squeezed digit must keep between its stems, else no squeeze
  packOnes: 1,       // 1 = a row made only of 1s (1, 11) doesn't stretch across the row: each 1 keeps
                     //     the width it has beside a wide digit and the group sits at the right
};

export const PALETTE = {
  red: [227, 0, 15],
  blue: [0, 48, 135],
  white: [240, 240, 240],
  yellow: [255, 221, 0],
};
const RING = [PALETTE.red, PALETTE.blue, PALETTE.white, PALETTE.yellow];
const MASK = [0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110, 0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111];

export function paletteFromRot(rot) {
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
  const t = g.stroke;
  const x0 = x + g.marginX, x1 = x + w - g.marginX;
  const y0 = y + g.marginY, y1 = y + h - g.marginY;
  const mid = Math.floor((y0 + y1) / 2);

  if (d === 1 && g.oneStyle === "centered") {
    const bx = Math.floor((x0 + x1) / 2 - t / 2);
    fillWipe(cv, bx, y0, t, y1 - y0, top, bottom, yCut);
    return;
  }

  const mask = MASK[d] ?? 0;
  const gOn = (mask & (1 << 6)) !== 0;
  // upper stems stop at the middle bar; lower stems run from the middle to the
  // bottom edge (they start at mid, so they overlap G rather than fall short of D)
  const halfTop = Math.max(0, gOn ? mid - y0 - Math.floor(t / 2) : mid - y0);
  const halfBot = Math.max(0, y1 - mid);
  if (mask & (1 << 0)) fillWipe(cv, x0, y0, x1 - x0, t, top, bottom, yCut);                       // A
  if (mask & (1 << 6)) fillWipe(cv, x0, mid - Math.floor(t / 2), x1 - x0, t, top, bottom, yCut);  // G
  if (mask & (1 << 3)) fillWipe(cv, x0, y1 - t, x1 - x0, t, top, bottom, yCut);                   // D
  if (mask & (1 << 5)) fillWipe(cv, x0, y0, t, halfTop, top, bottom, yCut);                       // F
  if (mask & (1 << 4)) fillWipe(cv, x0, mid, t, halfBot, top, bottom, yCut);                      // E
  if (mask & (1 << 1)) fillWipe(cv, x1 - t, y0, t, halfTop, top, bottom, yCut);                   // B
  if (mask & (1 << 2)) fillWipe(cv, x1 - t, mid, t, halfBot, top, bottom, yCut);                  // C
}

export function layoutRow(digits, g, rx0, rx1) {
  const weights = digits.map((d) => (d === 1 ? g.weightNarrow : g.weightWide));
  const total = weights.reduce((a, b) => a + b, 0);
  const width = rx1 - rx0;
  if (g.packOnes && digits.every((d) => d === 1)) {
    const w = Math.floor((width * g.weightNarrow) / (g.weightNarrow + g.weightWide));
    return digits.map((d, i) => ({ d, x: rx1 - (digits.length - i) * w, w }));
  }
  let x = rx0;
  return digits.map((d, i) => {
    const w = i === digits.length - 1 ? rx1 - x : Math.floor((width * weights[i]) / total);
    const cell = { d, x, w };
    x += w;
    return cell;
  });
}

// x of the stem that can extend out of a cell: right stem for 4/7, the bar for a 1, left stem for 4.
export function stemX(cell, g, side) {
  const t = g.stroke;
  const x0 = cell.x + g.marginX, x1 = cell.x + cell.w - g.marginX;
  if (cell.d === 1 && g.oneStyle === "centered") return Math.floor((x0 + x1) / 2 - t / 2);
  if (side === "right" && (cell.d === 4 || cell.d === 7)) return x1 - t;
  if (side === "left" && cell.d === 4) return x0;
  return null;
}

// A squeezed row is only allowed if every digit stays legible: a wide digit keeps
// daylight between its stems, a centred 1 keeps clear space beside its bar.
export function rowLegible(cells, g) {
  return cells.every((c) => (c.d === 1 && g.oneStyle === "centered")
    ? c.w >= g.stroke + 4
    : c.w - 2 * g.marginX >= 2 * g.stroke + g.minHole);
}

// Compute the full layout for a time (cells + stems), without drawing.
// Stems only extend when the row they squeeze stays readable, so 1:00 keeps
// its minutes (a lone hour "1" would otherwise crush them into blocks).
export function layoutClock(hh, mm, size, geometry = {}) {
  const g = { ...GEOMETRY, ...geometry };
  const hours = hh < 10 && !g.leadingZero ? [hh] : [Math.floor(hh / 10), hh % 10];
  const minutes = [Math.floor(mm / 10), mm % 10];
  let hcells = layoutRow(hours, g, 0, size);
  let mcells = layoutRow(minutes, g, 0, size);
  let descX = null, ascX = null;
  if (g.quirk) {
    const lastH = hcells[hcells.length - 1], firstM = mcells[0];
    let wantDesc = stemX(lastH, g, "right") != null;
    let wantAsc = stemX(firstM, g, "left") != null && (firstM.d !== 1 || g.oneRises);
    // two extended 1s dissolve the rows into bars: extend neither
    if (lastH.d === 1 && firstM.d === 1) { wantDesc = false; wantAsc = false; }
    // the rising stem sits at the row's left edge, so it is fixed; squeeze the hour row first
    if (wantAsc) {
      const x = stemX(firstM, g, "left");
      const squeezed = layoutRow(hours, g, x + g.stroke + g.stemGap, size);
      if (rowLegible(squeezed, g)) { ascX = x; hcells = squeezed; }
    }
    // the dropping stem moves with the (possibly squeezed) hour row: measure it after
    if (wantDesc) {
      const x = stemX(hcells[hcells.length - 1], g, "right");
      const squeezed = layoutRow(minutes, g, 0, x - g.stemGap);
      if (rowLegible(squeezed, g)) { descX = x; mcells = squeezed; }
    }
  }
  return { g, hcells, mcells, descX, ascX };
}

export function drawClock(cv, hh, mm, ss, size = 64, geometry = {}) {
  const { g, hcells, mcells, descX, ascX } = layoutClock(hh, mm, size, geometry);
  const rowH = size / 2;
  const t = g.stroke;
  const yCut = Math.max(0, Math.min(size, Math.floor(((ss + 1) * size) / 60)));
  const cur = paletteFromRot(mm & 3);
  const prev = paletteFromRot((mm + 3) & 3);

  cv.rect(0, 0, size, size, [0, 0, 0]);
  drawDigit(cv, hcells[0].d, hcells[0].x, 0, hcells[0].w, rowH, cur.tl, prev.tl, yCut, g);
  if (hcells[1]) drawDigit(cv, hcells[1].d, hcells[1].x, 0, hcells[1].w, rowH, cur.tr, prev.tr, yCut, g);
  drawDigit(cv, mcells[0].d, mcells[0].x, rowH, mcells[0].w, rowH, cur.bl, prev.bl, yCut, g);
  drawDigit(cv, mcells[1].d, mcells[1].x, rowH, mcells[1].w, rowH, cur.br, prev.br, yCut, g);

  if (descX != null) {
    const [c0, c1] = hcells.length === 1 ? [cur.tl, prev.tl] : [cur.tr, prev.tr];
    fillWipe(cv, descX, rowH - g.marginY, t, size - g.marginY - (rowH - g.marginY), c0, c1, yCut);
  }
  if (ascX != null) fillWipe(cv, ascX, g.marginY, t, rowH, cur.bl, prev.bl, yCut);
}

// Draw a row of digits with the clock's geometry (used by the date page).
// colours: array of [r,g,b] per digit position.
export function drawDigitsRow(cv, digits, y, h, size, colours, geometry = {}) {
  const g = { ...GEOMETRY, packOnes: 0, ...geometry };   // a date's "1" or "11" stays centred
  const cells = layoutRow(digits, g, 0, size);
  cells.forEach((c, i) => drawDigit(cv, c.d, c.x, y, c.w, h, colours[i % colours.length], colours[i % colours.length], y + h, g));
  return cells;
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

// Times that exercise the interlocking stems.
export function quirkTimes() {
  return [
    [14, 41, 7], [17, 45, 20], [11, 11, 33], [21, 11, 45], [4, 41, 58], [12, 12, 5], [7, 17, 15], [14, 14, 25], [23, 59, 35], [10, 41, 45],
    [1, 14, 55], [19, 19, 2], [13, 37, 12], [9, 41, 22], [11, 17, 32], [21, 47, 42], [0, 10, 52], [16, 16, 3], [17, 7, 13], [4, 4, 23],
    [0, 44, 33], [22, 14, 43], [11, 41, 53], [7, 41, 4], [1, 1, 14], [21, 1, 24], [14, 10, 34], [15, 15, 44], [3, 17, 54], [11, 10, 6],
    [1, 0, 0], [1, 20, 30], [1, 44, 40], [1, 59, 50], [11, 0, 15], [21, 0, 25], [4, 10, 35], [10, 10, 45],
  ];
}

// ── pixel morph (same algorithm as the firmware transition) ─────
// Pixels lit in both frames stay put (colour cross-fades); pixels lit only in
// the outgoing frame travel to pixels lit only in the incoming frame, paired in
// scan order so the image re-flows rather than scatters.
// a, b: arrays of [r,g,b] per pixel (length size*size), null/black for unlit.
// Returns frame(e) -> array of [x, y, r, g, b] particles, or null if nothing to do.
export function buildMorph(a, b, size) {
  const lit = (p) => p && (p[0] | p[1] | p[2]);
  const stay = [], la = [], lb = [];
  for (let i = 0; i < size * size; i++) {
    const inA = lit(a[i]), inB = lit(b[i]);
    if (inA && inB) stay.push(i);
    else if (inA) la.push(i);
    else if (inB) lb.push(i);
  }
  if (!stay.length && (!la.length || !lb.length)) return null;
  const n = la.length && lb.length ? Math.max(la.length, lb.length) : 0;
  const mix = (ca, cb, e) => [Math.round(ca[0] + (cb[0] - ca[0]) * e), Math.round(ca[1] + (cb[1] - ca[1]) * e), Math.round(ca[2] + (cb[2] - ca[2]) * e)];
  return (e) => {
    const out = [];
    for (const i of stay) out.push([i % size, Math.floor(i / size), ...mix(a[i], b[i], e)]);
    for (let k = 0; k < n; k++) {
      const ia = la[Math.floor((k * la.length) / n)], ib = lb[Math.floor((k * lb.length) / n)];
      const ax = ia % size, ay = Math.floor(ia / size), bx = ib % size, by = Math.floor(ib / size);
      out.push([Math.round(ax + (bx - ax) * e), Math.round(ay + (by - ay) * e), ...mix(a[ia], b[ib], e)]);
    }
    // unmatched leftovers (one side empty): fade in place
    if (!n) {
      for (const i of la) out.push([i % size, Math.floor(i / size), ...mix(a[i], [0, 0, 0], e)]);
      for (const i of lb) out.push([i % size, Math.floor(i / size), ...mix([0, 0, 0], b[i], e)]);
    }
    return out;
  };
}

export function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
