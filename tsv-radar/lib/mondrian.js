// lib/mondrian.js
// A fresh Mondrian composition every visit: recursive subdivision, 2 px black
// gaps, blocks in the clock's palette. Frames build the composition up block
// by block so it animates in.

import { Canvas, C } from "./pixel.js";

const FRAMES = 8;
const PALETTE = [
  [C.black, 34],
  [C.white, 20],
  [C.red, 18],
  [C.blue, 16],
  [C.yellow, 12],
];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function pick(r) {
  const total = PALETTE.reduce((a, [, w]) => a + w, 0);
  let x = r() * total;
  for (const [c, w] of PALETTE) { if ((x -= w) < 0) return c; }
  return C.black;
}

export function composeMondrian(seed, size = 64) {
  const r = rng(seed);
  const gap = 2, min = 9;
  let rects = [{ x: 0, y: 0, w: size, h: size }];
  const splits = 6 + Math.floor(r() * 5);
  for (let i = 0; i < splits; i++) {
    // split the biggest rect most of the time, a random one otherwise
    rects.sort((a, b) => b.w * b.h - a.w * a.h);
    const idx = r() < 0.7 ? 0 : Math.floor(r() * rects.length);
    const rc = rects[idx];
    const vertical = rc.w > rc.h ? r() < 0.8 : r() < 0.2;
    const span = vertical ? rc.w : rc.h;
    if (span < 2 * min + gap) continue;
    const at = min + Math.floor(r() * (span - 2 * min - gap + 1));
    rects.splice(idx, 1);
    if (vertical) rects.push({ x: rc.x, y: rc.y, w: at, h: rc.h }, { x: rc.x + at + gap, y: rc.y, w: rc.w - at - gap, h: rc.h });
    else rects.push({ x: rc.x, y: rc.y, w: rc.w, h: at }, { x: rc.x, y: rc.y + at + gap, w: rc.w, h: rc.h - at - gap });
  }
  // colour, then shuffle the reveal order
  const blocks = rects.map((rc) => ({ ...rc, colour: pick(r) }));
  // make sure at least one of each primary shows up
  const have = new Set(blocks.map((b) => b.colour));
  for (const c of [C.red, C.blue, C.yellow]) if (!have.has(c)) blocks[Math.floor(r() * blocks.length)].colour = c;
  for (let i = blocks.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; }
  return blocks;
}

export function renderMondrian(blocks, phase, size = 64) {
  const cv = new Canvas(size, size);
  const shown = phase >= FRAMES - 1 ? blocks.length : Math.ceil(((phase + 1) / FRAMES) * blocks.length);
  blocks.slice(0, shown).forEach((b) => { if (b.colour !== C.black) cv.rect(b.x, b.y, b.w, b.h, b.colour); });
  return cv;
}

let current = { seed: 0, frames: [], at: 0 };
// A new composition per visit (sticky for 20 s so the frame fetches match).
export function mondrianFrames(size = 64) {
  if (Date.now() - current.at > 20000) {
    const seed = (Date.now() / 1000) >>> 0;
    const blocks = composeMondrian(seed, size);
    current = { seed, at: Date.now(), frames: Array.from({ length: FRAMES }, (_, i) => renderMondrian(blocks, i, size).toRgb565BE()) };
  }
  return current.frames;
}
export const MONDRIAN_FRAME_MS = 300;
