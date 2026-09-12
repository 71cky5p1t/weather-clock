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
  cv.textCentered(1, d.label.toUpperCase().slice(0, 10), C.white);

  // big 7-seg temperature (4 px stroke) + degree ring
  const t = d.temp == null ? null : Math.round(d.temp);
  const tc = tempColour(d.temp);
  const digits = t == null ? "--" : String(Math.abs(t));
  const dw = 16, dh = 24, gap = 2, y0 = 14;
  let x = 2;
  if (t != null && t < 0) { cv.rect(x, y0 + 11, 6, 2, tc); x += 8; }
  for (const ch of digits) { cv.sevenSeg(x, y0, dw, dh, ch === "-" ? "-" : ch, tc, 4); x += dw + gap; }
  cv.ring(x + 2, y0 + 2, 2, tc, 1);
  cv.ring(x + 2, y0 + 2, 3, tc, 1);

  // icon
  drawIcon(cv, d.icon, 46, 16, 16, phase);

  // LO | RAIN | HI: coloured accent bar, grey label, coloured value
  const cols = [
    { x: 0, w: 17, colour: C.sky, label: "LO", value: `${fmtTemp(today.lo)}°` },
    { x: 20, w: 25, colour: C.yellow, label: "RAIN", value: `${d.rainToday ?? "--"}%` },
    { x: 47, w: 17, colour: C.red, label: "HI", value: `${fmtTemp(today.hi)}°` },
  ];
  for (const c of cols) {
    cv.rect(c.x + 1, 43, c.w - 2, 2, c.colour);
    cv.text(c.x + Math.floor((c.w - Canvas.measure(c.label)) / 2), 47, c.label, C.grey);
    cv.text(c.x + Math.floor((c.w - Canvas.measure(c.value)) / 2), 56, c.value, c.colour);
  }
  return cv;
}

export function renderErrorCard(msg, size = 64) {
  const cv = new Canvas(size, size);
  drawIcon(cv, "unknown", 24, 6, 16);
  cv.textCentered(28, "WEATHER", C.grey);
  cv.textCentered(38, "OFFLINE", C.grey);
  cv.hline(20, 50, 24, C.dim);
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
