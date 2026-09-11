// lib/weather.js
// Open-Meteo weather fetch + pixel-art card rendering.

import { Canvas, C, drawIcon, wmoToIcon, tempColour } from "./pixel.js";

const LAT = Number(process.env.LAT || -19.26);
const LON = Number(process.env.LON || 146.82);
const LOCATION_NAME = process.env.LOCATION_NAME || "TOWNSVILLE";
const TZ = process.env.DISPLAY_TZ || "Australia/Brisbane";
const REFRESH_MS = Number(process.env.WEATHER_REFRESH_SECONDS || 600) * 1000;

export const weather = {
  updatedAt: 0,
  lastError: null,
  data: null, // normalised summary
  frames: [], // today card
  forecastFrames: [], // 3-day card
  detailFrames: [], // dense current-conditions card
  refreshing: false,
};

function buildUrl() {
  const p = new URLSearchParams({
    latitude: String(LAT),
    longitude: String(LON),
    timezone: TZ,
    forecast_days: "4",
    current: [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
      "is_day",
      "precipitation",
    ].join(","),
    hourly: ["precipitation_probability", "temperature_2m"].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "uv_index_max",
      "sunrise",
      "sunset",
    ].join(","),
  });
  return `https://api.open-meteo.com/v1/forecast?${p.toString()}`;
}

function windDir(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function dayName(iso) {
  // iso like 2026-09-07 → "MON"
  const d = new Date(`${iso}T12:00:00`);
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: TZ }).format(d).toUpperCase();
}

function normalise(raw) {
  const cur = raw.current || {};
  const daily = raw.daily || {};
  const hourly = raw.hourly || {};

  // rain chance for the rest of today: max of remaining hourly probabilities
  let rainToday = daily.precipitation_probability_max?.[0] ?? null;
  if (Array.isArray(hourly.time) && Array.isArray(hourly.precipitation_probability)) {
    const nowIso = cur.time || "";
    const idx = hourly.time.findIndex((t) => t >= nowIso);
    if (idx >= 0) {
      const rest = hourly.precipitation_probability.slice(idx, idx + 12).filter((v) => v != null);
      if (rest.length) rainToday = Math.max(...rest);
    }
  }

  const days = (daily.time || []).slice(0, 4).map((iso, i) => ({
    date: iso,
    day: dayName(iso),
    code: daily.weather_code?.[i] ?? null,
    hi: daily.temperature_2m_max?.[i] ?? null,
    lo: daily.temperature_2m_min?.[i] ?? null,
    rain: daily.precipitation_probability_max?.[i] ?? null,
    uv: daily.uv_index_max?.[i] ?? null,
    sunrise: daily.sunrise?.[i] ?? null,
    sunset: daily.sunset?.[i] ?? null,
    ...wmoToIcon(daily.weather_code?.[i], true),
  }));

  return {
    location: LOCATION_NAME,
    time: cur.time,
    temp: cur.temperature_2m,
    feels: cur.apparent_temperature,
    humidity: cur.relative_humidity_2m,
    code: cur.weather_code,
    isDay: cur.is_day === 1,
    wind: cur.wind_speed_10m,
    windDir: windDir(cur.wind_direction_10m ?? 0),
    precip: cur.precipitation,
    rainToday,
    ...wmoToIcon(cur.weather_code, cur.is_day === 1),
    days,
  };
}

// ── rendering ────────────────────────────────────────────────────
function fmtTemp(t) {
  if (t == null) return "--";
  return String(Math.round(t));
}

export function renderCurrentCard(d, size = 64) {
  const cv = new Canvas(size, size);

  // header
  cv.textCentered(1, d.location.slice(0, 15), C.grey, { font: "3x5" });
  cv.hline(0, 7, size, C.dim);

  // icon + big temperature
  drawIcon(cv, d.icon, 2, 10, 16);
  const temp = fmtTemp(d.temp);
  const tc = tempColour(d.temp);
  const bigW = Canvas.measure(temp, { scale: 2 });
  const tx = 24 + Math.floor((38 - bigW - 6) / 2);
  cv.text(tx, 10, temp, tc, { scale: 2 });
  cv.text(tx + bigW + 1, 10, "°", tc, { scale: 1 });

  // condition label
  cv.textCentered(27, d.label.toUpperCase().slice(0, 15), C.white, { font: "3x5" });

  cv.hline(0, 34, size, C.dim);

  // details rows (3x5 font: 4px per char)
  const rowY = 37;
  cv.text(2, rowY, "FEELS", C.grey, { font: "3x5" });
  cv.text(26, rowY, `${fmtTemp(d.feels)}°`, tempColour(d.feels), { font: "3x5" });
  cv.text(46, rowY, "H", C.grey, { font: "3x5" });
  cv.textRight(62, rowY, `${d.humidity ?? "--"}%`, C.cyan, { font: "3x5" });

  const today = d.days[0] || {};
  cv.text(2, rowY + 7, "H", C.grey, { font: "3x5" });
  cv.text(6, rowY + 7, `${fmtTemp(today.hi)}°`, C.orange, { font: "3x5" });
  cv.text(22, rowY + 7, "L", C.grey, { font: "3x5" });
  cv.text(26, rowY + 7, `${fmtTemp(today.lo)}°`, C.sky, { font: "3x5" });
  cv.text(46, rowY + 7, "UV", C.grey, { font: "3x5" });
  cv.textRight(62, rowY + 7, `${today.uv != null ? Math.round(today.uv) : "-"}`, C.purple, { font: "3x5" });

  cv.text(2, rowY + 14, "RAIN", C.grey, { font: "3x5" });
  const rc = d.rainToday == null ? C.grey : d.rainToday >= 50 ? C.rain : d.rainToday >= 20 ? C.cyan : C.green;
  cv.text(22, rowY + 14, `${d.rainToday ?? "--"}%`, rc, { font: "3x5" });
  const windTxt = `${d.wind != null ? Math.round(d.wind) : "--"}${d.windDir}`;
  const windW = Canvas.measure(windTxt, { font: "3x5" });
  cv.text(62 - windW - 5, rowY + 14, "W", C.grey, { font: "3x5" });
  cv.textRight(62, rowY + 14, windTxt, C.white, { font: "3x5" });

  // rain-chance bar along the bottom
  cv.hline(0, 58, size, C.dim);
  const pct = Math.max(0, Math.min(100, d.rainToday ?? 0));
  const barW = Math.round((pct / 100) * (size - 4));
  cv.rect(2, 60, size - 4, 3, C.dim);
  if (barW > 0) cv.rect(2, 60, barW, 3, C.rain);

  return cv;
}


// Single "today" card in the clock's Mondrian language: 7-seg temperature,
// icon, and three solid blocks (hi / lo / rain) with black text.
export function renderTodayCard(d, size = 64) {
  const cv = new Canvas(size, size);
  const today = d.days[0] || {};

  // header: weekday + date
  const dateStr = d.time
    ? new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: TZ })
        .formatToParts(new Date(d.time))
        .map((p) => (p.type === "month" || p.type === "weekday" ? p.value.slice(0, 3) : p.type === "literal" ? " " : p.value))
        .join("").replace(/\s+/g, " ").trim().toUpperCase()
    : d.location;
  cv.textCentered(1, dateStr.slice(0, 15), C.grey, { font: "3x5" });
  cv.hline(0, 7, size, C.dim);

  // big 7-seg temperature
  const t = d.temp == null ? null : Math.round(d.temp);
  const tc = tempColour(d.temp);
  const digits = t == null ? "--" : String(Math.abs(t));
  const dw = 14, dh = 22, gap = 2, y0 = 10;
  const totalW = digits.length * dw + (digits.length - 1) * gap + 5;
  let x = Math.max(1, Math.floor((42 - totalW) / 2));
  if (t != null && t < 0) { cv.rect(x, y0 + Math.floor(dh / 2) - 1, 5, 2, tc); x += 6; }
  for (const ch of digits) {
    cv.sevenSeg(x, y0, dw, dh, ch === "-" ? "-" : ch, tc);
    x += dw + gap;
  }
  cv.circle(x + 1, y0 + 2, 1, tc); // degree ring

  // icon
  drawIcon(cv, d.icon, 46, 12, 16);

  // condition
  cv.textCentered(35, d.label.toUpperCase().slice(0, 15), C.white, { font: "3x5" });

  // three Mondrian blocks
  const blocks = [
    { x: 1, colour: C.red, label: "HI", value: `${fmtTemp(today.hi)}°` },
    { x: 22, colour: C.blue, label: "LO", value: `${fmtTemp(today.lo)}°` },
    { x: 43, colour: C.yellow, label: "RAIN", value: `${d.rainToday ?? "--"}%` },
  ];
  for (const b of blocks) {
    cv.rect(b.x, 43, 20, 20, b.colour);
    const ink = C.black;
    cv.text(b.x + Math.floor((20 - Canvas.measure(b.label, { font: "3x5" })) / 2), 45, b.label, ink, { font: "3x5" });
    cv.text(b.x + Math.floor((20 - Canvas.measure(b.value)) / 2), 52, b.value, ink);
  }
  return cv;
}

export function renderForecastCard(d, size = 64) {
  const cv = new Canvas(size, size);
  cv.textCentered(1, "FORECAST", C.grey, { font: "3x5" });
  cv.hline(0, 7, size, C.dim);

  const days = d.days.slice(1, 4);
  const colW = Math.floor(size / 3); // 21
  days.forEach((day, i) => {
    const x0 = i * colW + 1;
    const cx = x0 + Math.floor(colW / 2);

    // day name
    const name = day.day.slice(0, 3);
    cv.text(cx - Math.floor(Canvas.measure(name, { font: "3x5" }) / 2), 10, name, C.white, { font: "3x5" });

    // icon
    drawIcon(cv, day.icon, cx - 8, 18, 16);

    // hi / lo
    const hi = `${fmtTemp(day.hi)}°`;
    const lo = `${fmtTemp(day.lo)}°`;
    cv.text(cx - Math.floor(Canvas.measure(hi, { font: "3x5" }) / 2), 36, hi, C.orange, { font: "3x5" });
    cv.text(cx - Math.floor(Canvas.measure(lo, { font: "3x5" }) / 2), 43, lo, C.sky, { font: "3x5" });

    // rain chance
    const rain = day.rain == null ? "--" : `${day.rain}%`;
    const rc = day.rain == null ? C.grey : day.rain >= 50 ? C.rain : day.rain >= 20 ? C.cyan : C.grey;
    cv.text(cx - Math.floor(Canvas.measure(rain, { font: "3x5" }) / 2), 51, rain, rc, { font: "3x5" });

    // column divider
    if (i < 2) cv.vline(x0 + colW - 1, 9, 50, C.dim);
  });

  // sunrise / sunset strip for today
  cv.hline(0, 58, size, C.dim);
  const t = d.days[0] || {};
  const hhmm = (iso) => (iso ? iso.slice(11, 16) : "--:--");
  cv.sprite(2, 59, ["..#..", ".###.", "#.#.#", "..#..", "..#.."], { "#": C.yellow });
  cv.text(9, 59, hhmm(t.sunrise), C.yellow, { font: "3x5" });
  cv.sprite(57, 59, ["..#..", "..#..", "#.#.#", ".###.", "..#.."], { "#": C.orange });
  cv.textRight(55, 59, hhmm(t.sunset), C.orange, { font: "3x5" });

  return cv;
}

export function renderErrorCard(msg, size = 64) {
  const cv = new Canvas(size, size);
  drawIcon(cv, "unknown", 24, 8, 16);
  cv.textCentered(30, "WEATHER", C.grey, { font: "3x5" });
  cv.textCentered(37, "UNAVAILABLE", C.grey, { font: "3x5" });
  const lines = Canvas.wrap(String(msg || "").slice(0, 60), size - 4, { font: "3x5" }).slice(0, 2);
  lines.forEach((l, i) => cv.textCentered(48 + i * 7, l, C.dim, { font: "3x5" }));
  return cv;
}

export async function refreshWeather(size = 64) {
  if (weather.refreshing) return;
  weather.refreshing = true;
  try {
    const res = await fetch(buildUrl(), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`);
    const raw = await res.json();
    const d = normalise(raw);
    weather.data = d;
    weather.frames = [renderTodayCard(d, size).toRgb565BE()];
    weather.forecastFrames = [renderForecastCard(d, size).toRgb565BE()];
    weather.detailFrames = [renderCurrentCard(d, size).toRgb565BE()];
    weather.updatedAt = Date.now();
    weather.lastError = null;
  } catch (err) {
    weather.lastError = err.message;
    if (!weather.frames.length) {
      weather.frames = [renderErrorCard(err.message, size).toRgb565BE()];
    }
    throw err;
  } finally {
    weather.refreshing = false;
  }
}

export function startWeatherScheduler(size = 64) {
  const tick = () => refreshWeather(size).catch((err) => console.error("weather refresh failed:", err.message));
  tick();
  setInterval(tick, REFRESH_MS);
}
