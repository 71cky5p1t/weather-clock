// lib/clock.js
// Server wrapper around clock-core.js: renders to a pixel Canvas for PNG
// previews and contact sheets. The geometry lives in clock-core.js.

import { Canvas } from "./pixel.js";
import { GEOMETRY, drawClock, sampleTimes, quirkTimes } from "./clock-core.js";

export { GEOMETRY, sampleTimes, quirkTimes };

export function renderClock(hh, mm, ss, size = 64, geometry = {}) {
  const cv = new Canvas(size, size);
  drawClock(cv, hh, mm, ss, size, geometry);
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
