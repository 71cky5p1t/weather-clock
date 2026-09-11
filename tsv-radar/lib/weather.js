// lib/weather.js
// Open-Meteo weather fetch + pixel-art card rendering.

import { Canvas, C, drawIcon, wmoToIcon, tempColour, ICON_PHASES } from "./pixel.js";

const LAT = Number(process.env.LAT || -19.26);
const LON = Number(process.env.LON || 146.82);
const LOCATION_NAME = process.env.LOCATION_NAME || "TOWNSVILLE";
const TZ = process.env.DISPLAY_TZ || "Australia/Brisbane";
const REFRESH_MS = Number(process.env.WEATHER_REFRESH_SECONDS || 600) * 1000;

export const weather = {
  updatedAt: 0,
  lastError: null,
  data: null, // normalised summary
  frames: [], // today card, one per icon animation phase
  frameDelayMs: 350,
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

// Single "today" card in the clock's Mondrian language: 7-seg temperature,
// icon, and three solid blocks (hi / lo / rain) with black text.
export function renderTodayCard(d, size = 64, phase = 0) {
  const cv = new Canvas(size, size);
  const today = d.days[0] || {};

  // header: condition (the date has its own page)
  cv.textCentered(1, d.label.toUpperCase().slice(0, 15), C.white, { font: "3x5" });
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
  drawIcon(cv, d.icon, 46, 12, 16, phase);

  // three columns: LO | RAIN | HI. Coloured accent bar + coloured text on
  // black (solid blocks with black text were hard to read on the panel).
  const cols = [
    { x: 0, colour: C.sky, label: "LO", value: `${fmtTemp(today.lo)}°` },
    { x: 21, colour: C.yellow, label: "RAIN", value: `${d.rainToday ?? "--"}%` },
    { x: 43, colour: C.red, label: "HI", value: `${fmtTemp(today.hi)}°` },
  ];
  cv.hline(0, 38, size, C.dim);
  for (const c of cols) {
    const w = 21;
    cv.rect(c.x + 2, 42, w - 4, 2, c.colour);
    cv.text(c.x + Math.floor((w - Canvas.measure(c.label, { font: "3x5" })) / 2), 47, c.label, C.grey, { font: "3x5" });
    cv.text(c.x + Math.floor((w - Canvas.measure(c.value)) / 2), 55, c.value, c.colour);
  }
  cv.vline(21, 42, 21, C.dim);
  cv.vline(42, 42, 21, C.dim);
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
    weather.frames = Array.from({ length: ICON_PHASES }, (_, i) => renderTodayCard(d, size, i).toRgb565BE());
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
