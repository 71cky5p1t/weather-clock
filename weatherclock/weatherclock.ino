// weatherclock.ino — LED matrix weather clock, v2
//
// The display plays a playlist served by tsv-radar/server.js:
//   CLOCK   pages are rendered locally (Mondrian 7-seg clock, seconds wipe)
//   BITMAP  pages (radar loop, weather cards, quotes, messages, your own
//           images) are fetched as ready-made 64x64 RGB565 frames.
//
// Highlights vs v1:
//   - playlist, brightness schedule and timezone come from the server
//   - next page's frames are prefetched on core 0 so transitions never stall
//   - WiFi / NTP recovery, heartbeat to the dashboard, optional OTA
//   - credentials live in secrets.h, pins in board.h
//
// Libraries: Adafruit Protomatter, Adafruit GFX, ArduinoJson (v7)

#define FW_VERSION "2.0.0"

#include "board.h"
#include "secrets.h"
#include "types.h"

#include <Adafruit_Protomatter.h>
#include <Adafruit_GFX.h>
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <ArduinoJson.h>
#include <esp_heap_caps.h>
#include <time.h>

// ── TUNABLES ─────────────────────────────────────────────────────
static const int      MAX_FRAMES      = MAX_FRAMES_T; // per bitmap page (server NUM_FRAMES <= this)
static const int      MAX_PAGES       = MAX_PAGES_T;
static const uint32_t MORPH_MS        = 900;       // pixel-morph transition length
static const uint32_t CLOCK_TICK_MS   = 40;
static const uint32_t HTTP_TIMEOUT_MS = 8000;
static const uint32_t WIFI_GIVEUP_MS  = 5 * 60 * 1000;  // reboot if offline this long
static const uint32_t OTA_RETRY_MS    = 60 * 60 * 1000;

#define WIDTH  MATRIX_WIDTH
#define HEIGHT MATRIX_HEIGHT
static const int FRAME_PIXELS = WIDTH * HEIGHT;
static const size_t FRAME_BYTES = FRAME_PIXELS * sizeof(uint16_t);

// ── MATRIX ───────────────────────────────────────────────────────
Adafruit_Protomatter matrix(
  WIDTH, MATRIX_BITDEPTH, MATRIX_CHAINS,
  RGB_PINS, NUM_ADDR_PINS, ADDR_PINS,
  CLOCK_PIN, LATCH_PIN, OE_PIN, true
);

// ── CONFIG (from /api/manifest) ──────────────────────────────────
static Config cfg;
static bool   cfgFromServer = false;

static void setDefaultConfig(Config &c) {
  memset(&c, 0, sizeof(c));
  c.pollMs = 60000;
  strlcpy(c.tz, "AEST-10", sizeof(c.tz));
  c.brightDay = 200;
  c.brightNight = 26;
  c.nightStart = 22;
  c.nightEnd = 7;
  strlcpy(c.rev, "none", sizeof(c.rev));
  c.pageCount = 1;
  c.pages[0].type = PAGE_CLOCK;
  c.pages[0].durationMs = 10000;
  strlcpy(c.pages[0].name, "clock", sizeof(c.pages[0].name));
}

// ── DEVICE IDENTITY ──────────────────────────────────────────────
static char deviceId[32];

static void initDeviceId() {
#ifdef DEVICE_ID
  strlcpy(deviceId, DEVICE_ID, sizeof(deviceId));
#else
  uint64_t mac = ESP.getEfuseMac();   // factory MAC, valid before WiFi starts
  snprintf(deviceId, sizeof(deviceId), "mp-%06lx", (unsigned long)((mac >> 24) & 0xFFFFFF));
#endif
}

// ── BRIGHTNESS ───────────────────────────────────────────────────
static uint8_t BRIGHT = 200;          // effective brightness used by col()
static uint8_t scheduledBright = 200; // day/night value before fades

static bool isNightHour(int h) {
  if (cfg.nightStart == cfg.nightEnd) return false;
  if (cfg.nightStart < cfg.nightEnd) return h >= cfg.nightStart && h < cfg.nightEnd;
  return h >= cfg.nightStart || h < cfg.nightEnd; // wraps midnight
}

static bool getLocalTimeSafe(struct tm *info) {
  time_t now = time(nullptr);
  if (now < 1700000000) return false;
  localtime_r(&now, info);
  return true;
}

static void updateScheduledBright() {
  struct tm info;
  if (getLocalTimeSafe(&info)) scheduledBright = isNightHour(info.tm_hour) ? cfg.brightNight : cfg.brightDay;
  else scheduledBright = cfg.brightDay;
}

static inline uint16_t col(uint8_t r, uint8_t g, uint8_t b) {
  uint16_t rs = (uint16_t)((uint32_t)r * BRIGHT + 127) / 255;
  uint16_t gs = (uint16_t)((uint32_t)g * BRIGHT + 127) / 255;
  uint16_t bs = (uint16_t)((uint32_t)b * BRIGHT + 127) / 255;
  return matrix.color565(rs, gs, bs);
}

static inline uint16_t scale565(uint16_t c, uint8_t a) {
  uint16_t r = (c >> 11) & 0x1F, g = (c >> 5) & 0x3F, b = c & 0x1F;
  r = (uint16_t)((uint32_t)r * a + 127) / 255;
  g = (uint16_t)((uint32_t)g * a + 127) / 255;
  b = (uint16_t)((uint32_t)b * a + 127) / 255;
  return (r << 11) | (g << 5) | b;
}

// ── MONDRIAN CLOCK ───────────────────────────────────────────────
static uint16_t MONDRIAN_RED()    { return col(227, 0, 15); }
static uint16_t MONDRIAN_BLUE()   { return col(0, 48, 135); }
static uint16_t MONDRIAN_YELLOW() { return col(255, 221, 0); }
static uint16_t MONDRIAN_WHITE()  { return col(240, 240, 240); }
static uint16_t MONDRIAN_BLACK()  { return col(0, 0, 0); }

static void paletteFromRot(int rot, uint16_t &tl, uint16_t &tr, uint16_t &br, uint16_t &bl) {
  uint16_t ring[4] = { MONDRIAN_RED(), MONDRIAN_BLUE(), MONDRIAN_WHITE(), MONDRIAN_YELLOW() };
  tl = ring[(0 - rot + 4) & 3];
  tr = ring[(1 - rot + 4) & 3];
  br = ring[(2 - rot + 4) & 3];
  bl = ring[(3 - rot + 4) & 3];
}

static const uint8_t DIGIT_MASK[10] = {
  0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110,
  0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111
};

static void fillRectWipe(int x, int y, int w, int h, uint16_t cTop, uint16_t cBot, int yCut) {
  if (w <= 0 || h <= 0) return;
  int yEnd = y + h;
  if (yEnd <= yCut)      matrix.fillRect(x, y, w, h, cTop);
  else if (y >= yCut)    matrix.fillRect(x, y, w, h, cBot);
  else {
    int hTop = yCut - y; if (hTop > 0) matrix.fillRect(x, y, w, hTop, cTop);
    int hBot = yEnd - yCut; if (hBot > 0) matrix.fillRect(x, yCut, w, hBot, cBot);
  }
}

// Digit geometry — keep in sync with tsv-radar/lib/clock-core.js GEOMETRY.
// Chosen from a 100-time contact-sheet review: uniform 6 px stroke, 2 px
// margins, and a "1" drawn as a single centred bar.
static const int DIGIT_MARGIN_X = 2;
static const int DIGIT_MARGIN_Y = 2;
static const int DIGIT_STROKE   = 6;

static void drawSegmentRects(int x, int y, int w, int h, uint8_t mask, uint16_t cTop, uint16_t cBot, int yCut) {
  const int t = DIGIT_STROKE;
  int x0 = x + DIGIT_MARGIN_X, x1 = x + w - DIGIT_MARGIN_X;
  int y0 = y + DIGIT_MARGIN_Y, y1 = y + h - DIGIT_MARGIN_Y;
  int mid = (y0 + y1) / 2;

  if (mask & (1 << 0)) fillRectWipe(x0, y0,        x1 - x0, t, cTop, cBot, yCut); // A
  if (mask & (1 << 6)) fillRectWipe(x0, mid - t/2, x1 - x0, t, cTop, cBot, yCut); // G
  if (mask & (1 << 3)) fillRectWipe(x0, y1 - t,    x1 - x0, t, cTop, cBot, yCut); // D

  bool gOn = (mask & (1 << 6)) != 0;
  int halfTop = gOn ? (mid - y0 - t/2) : (mid - y0);
  int halfBot = gOn ? (y1 - (mid + t/2)) : (y1 - mid);
  if (halfTop < 0) halfTop = 0;
  if (halfBot < 0) halfBot = 0;

  if (mask & (1 << 5)) fillRectWipe(x0,     y0,  t, halfTop, cTop, cBot, yCut); // F
  if (mask & (1 << 4)) fillRectWipe(x0,     mid, t, halfBot, cTop, cBot, yCut); // E
  if (mask & (1 << 1)) fillRectWipe(x1 - t, y0,  t, halfTop, cTop, cBot, yCut); // B
  if (mask & (1 << 2)) fillRectWipe(x1 - t, mid, t, halfBot, cTop, cBot, yCut); // C
}

static void drawDigitInCell(uint8_t d, int cx, int cy, int cw, int ch, uint16_t cTop, uint16_t cBot, int yCut) {
  if (d > 9) d = 0;
  if (d == 1) {
    // a lone centred bar reads better than the right-hand 7-seg "1"
    int x0 = cx + DIGIT_MARGIN_X, x1 = cx + cw - DIGIT_MARGIN_X;
    int bx = (x0 + x1) / 2 - DIGIT_STROKE / 2;
    fillRectWipe(bx, cy + DIGIT_MARGIN_Y, DIGIT_STROKE, ch - 2 * DIGIT_MARGIN_Y, cTop, cBot, yCut);
    return;
  }
  drawSegmentRects(cx, cy, cw, ch, DIGIT_MASK[d], cTop, cBot, yCut);
}

// Flux-style layout: digits share the row width in proportion to how much
// room they need. A "1" is narrow, everything else is wide, and a single-digit
// hour stretches across the whole row.
// Quirk (mirrors tsv-radar/lib/clock-core.js): the last hour digit, if it is a
// 4/7/1, drops its right-hand stem through the minute row; the first minute
// digit, if 4 (or 1 with ONE_RISES), raises its left stem through the hour
// row. Rows squeeze sideways to make room, but only while every digit in the
// squeezed row stays legible (MIN_HOLE px between its stems) - otherwise a
// lone hour "1" would crush 1:00's minutes into solid blocks.
static const int  STEM_GAP  = 3;
static const int  MIN_HOLE  = 3;
static const bool ONE_RISES = false;   // a rising minute "1" reads as a leading hour digit (04:10 -> 14:10)

static int digitWeight(int d) { return d == 1 ? 40 : 100; }

static void layoutRow(const int *digits, int n, Cell *cells, int rx0, int rx1) {
  int total = 0;
  for (int i = 0; i < n; i++) total += digitWeight(digits[i]);
  int width = rx1 - rx0, x = rx0;
  for (int i = 0; i < n; i++) {
    int w = (i == n - 1) ? (rx1 - x) : (width * digitWeight(digits[i])) / total;
    cells[i] = { digits[i], x, w };
    x += w;
  }
}

// x of a stem that can extend out of its cell, or -1.
static int stemX(const Cell &c, bool rightSide) {
  int x0 = c.x + DIGIT_MARGIN_X, x1 = c.x + c.w - DIGIT_MARGIN_X;
  if (c.d == 1) return (x0 + x1) / 2 - DIGIT_STROKE / 2;
  if (rightSide && (c.d == 4 || c.d == 7)) return x1 - DIGIT_STROKE;
  if (!rightSide && c.d == 4) return x0;
  return -1;
}

// A squeezed row is only allowed if every digit stays legible: a wide digit
// keeps daylight between its stems, a centred 1 keeps clear space beside its bar.
static bool rowLegible(const Cell *cells, int n) {
  for (int i = 0; i < n; i++) {
    if (cells[i].d == 1) { if (cells[i].w < DIGIT_STROKE + 4) return false; }
    else if (cells[i].w - 2 * DIGIT_MARGIN_X < 2 * DIGIT_STROKE + MIN_HOLE) return false;
  }
  return true;
}

static void drawClockDigits(int hh, int mm, int ss, bool /*colonOn*/) {
  matrix.fillScreen(MONDRIAN_BLACK());
  const int rowH = HEIGHT / 2;
  int yCut = ((ss + 1) * HEIGHT) / 60;
  yCut = constrain(yCut, 0, HEIGHT);

  int rotCur = mm & 3, rotPrev = (mm + 3) & 3;
  uint16_t TLc, TRc, BRc, BLc, TLp, TRp, BRp, BLp;
  paletteFromRot(rotCur, TLc, TRc, BRc, BLc);
  paletteFromRot(rotPrev, TLp, TRp, BRp, BLp);

  int hd[2], hn;
  if (hh < 10) { hd[0] = hh; hn = 1; } else { hd[0] = hh / 10; hd[1] = hh % 10; hn = 2; }
  int md[2] = { mm / 10, mm % 10 };
  Cell hc[2], mc[2];

  // pass 1: full-width layout to find the stems that want to extend
  layoutRow(hd, hn, hc, 0, WIDTH);
  layoutRow(md, 2, mc, 0, WIDTH);
  bool wantDesc = stemX(hc[hn - 1], true) >= 0;
  bool wantAsc  = stemX(mc[0], false) >= 0 && (mc[0].d != 1 || ONE_RISES);
  if (hc[hn - 1].d == 1 && mc[0].d == 1) { wantDesc = false; wantAsc = false; }   // two tall 1s dissolve the rows

  // pass 2: squeeze each row away from the other's stem, but only if it stays legible.
  // The rising stem sits at the row's left edge (fixed), so squeeze the hour row first;
  // the dropping stem moves with the squeezed hour row, so measure it afterwards.
  int descX = -1, ascX = -1;
  Cell tmp[2];
  if (wantAsc) {
    int x = stemX(mc[0], false);
    layoutRow(hd, hn, tmp, x + DIGIT_STROKE + STEM_GAP, WIDTH);
    if (rowLegible(tmp, hn)) { ascX = x; hc[0] = tmp[0]; hc[1] = tmp[1]; }
  }
  if (wantDesc) {
    int x = stemX(hc[hn - 1], true);
    layoutRow(md, 2, tmp, 0, x - STEM_GAP);
    if (rowLegible(tmp, 2)) { descX = x; mc[0] = tmp[0]; mc[1] = tmp[1]; }
  }

  drawDigitInCell(hc[0].d, hc[0].x, 0, hc[0].w, rowH, TLc, TLp, yCut);
  if (hn == 2) drawDigitInCell(hc[1].d, hc[1].x, 0, hc[1].w, rowH, TRc, TRp, yCut);
  drawDigitInCell(mc[0].d, mc[0].x, rowH, mc[0].w, rowH, BLc, BLp, yCut);
  drawDigitInCell(mc[1].d, mc[1].x, rowH, mc[1].w, rowH, BRc, BRp, yCut);

  // extensions through the other row
  if (descX >= 0) {
    uint16_t cc = (hn == 1) ? TLc : TRc, cp = (hn == 1) ? TLp : TRp;
    fillRectWipe(descX, rowH - DIGIT_MARGIN_Y, DIGIT_STROKE, HEIGHT - rowH, cc, cp, yCut);
  }
  if (ascX >= 0) fillRectWipe(ascX, DIGIT_MARGIN_Y, DIGIT_STROKE, rowH, BLc, BLp, yCut);
}

// Draw the clock into the canvas at (scheduled brightness × alpha); no show().
static void drawClock(uint8_t alpha) {
  struct tm info;
  BRIGHT = (uint8_t)((uint32_t)scheduledBright * alpha / 255);
  if (!getLocalTimeSafe(&info)) {
    // No time yet: show dashes so it's obvious rather than "00:00".
    matrix.fillScreen(0);
    matrix.setTextColor(col(120, 120, 120));
    matrix.setCursor(8, 28);
    matrix.print("--:--");
    return;
  }
  drawClockDigits(info.tm_hour, info.tm_min, info.tm_sec, (info.tm_sec % 2) == 0);
}

static void renderClock(uint8_t alpha);   // defined after the morph helpers


// ── TIMER PAGE ───────────────────────────────────────────────────
// Minutes over seconds in the clock's digits; wipe shows the current minute
// draining. When it reaches zero the panel flashes red for a while.
static void drawTimer(uint8_t alpha) {
  BRIGHT = (uint8_t)((uint32_t)scheduledBright * alpha / 255);
  time_t now = time(nullptr);
  long remaining = (long)page().endsAt - (long)now;
  if (remaining <= 0) {
    bool on = (millis() / 500) % 2 == 0;
    matrix.fillScreen(on ? col(227, 0, 15) : 0);
    if (!on) drawClockDigits(0, 0, 59, false);
    return;
  }
  int mm = min(99L, remaining / 60);
  int ss = remaining % 60;
  drawClockDigits(mm, ss, 59 - ss, false);
}

// ── STATUS SCREEN ────────────────────────────────────────────────
static void showStatus(const char *l1, const char *l2 = nullptr, const char *l3 = nullptr, uint16_t colour = 0) {
  BRIGHT = scheduledBright;
  matrix.fillScreen(0);
  matrix.setTextWrap(false);
  matrix.setTextSize(1);
  matrix.setTextColor(colour ? colour : col(255, 221, 0));
  matrix.setCursor(2, 18); if (l1) matrix.print(l1);
  matrix.setTextColor(col(200, 200, 200));
  matrix.setCursor(2, 30); if (l2) matrix.print(l2);
  matrix.setCursor(2, 42); if (l3) matrix.print(l3);
  matrix.show();
}

// ── FRAME POOLS ──────────────────────────────────────────────────
static FramePool pools[2];
static int poolCount = 0;
static uint16_t *fadeTmp = nullptr;

static void allocPools() {
  bool psram = psramFound();
  size_t bytes = (size_t)MAX_FRAMES * FRAME_BYTES;
  int want = psram ? 2 : 1;
  for (int i = 0; i < want; i++) {
    void *p = psram ? heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM) : malloc(bytes);
    if (!p && psram) p = malloc(bytes);
    if (!p) break;
    pools[i].data = (uint16_t *)p;
    pools[i].count = 0;
    pools[i].ready = false;
    pools[i].name[0] = 0;
    poolCount = i + 1;
  }
  fadeTmp = (uint16_t *)malloc(FRAME_BYTES);
  Serial.printf("pools: %d (psram=%d) heap=%lu psram=%lu\n", poolCount, psram, (unsigned long)ESP.getFreeHeap(), (unsigned long)ESP.getFreePsram());
}

static inline uint16_t *poolFrame(FramePool &p, int i) { return p.data + (size_t)i * FRAME_PIXELS; }

// Draw a pooled frame into the canvas at (scheduled brightness × alpha); no show().
static void drawBitmap(FramePool &p, int frame, uint8_t alpha) {
  if (!p.ready || p.count <= 0) return;
  frame = constrain(frame, 0, p.count - 1);
  uint8_t total = (uint8_t)((uint32_t)scheduledBright * alpha / 255);
  uint16_t *src = poolFrame(p, frame);
  if (total == 255) {
    matrix.drawRGBBitmap(0, 0, src, WIDTH, HEIGHT);
  } else {
    for (int i = 0; i < FRAME_PIXELS; i++) fadeTmp[i] = scale565(src[i], total);
    matrix.drawRGBBitmap(0, 0, fadeTmp, WIDTH, HEIGHT);
  }
}

static void renderBitmap(FramePool &p, int frame, uint8_t alpha) {
  drawBitmap(p, frame, alpha);
  matrix.show();
}

// ── MORPH TRANSITION ─────────────────────────────────────────────
// Every lit pixel of the outgoing page travels to the position (and colour)
// of a lit pixel in the incoming page. Pairing is by scan order, so the image
// re-flows rather than scatters.
static uint16_t *snapA = nullptr, *snapB = nullptr;   // canvas snapshots
static uint16_t *morphA = nullptr, *morphB = nullptr; // lit pixel indices
static int morphNA = 0, morphNB = 0, morphCount = 0;
static bool morphReady = false;
static const ExRect *morphEx = nullptr;   // regions cut instead of morphed (set per morph)
static int morphExCount = 0;

static inline bool inExcluded(int i) {
  int x = i & (WIDTH - 1), y = i / WIDTH;
  for (int k = 0; k < morphExCount; k++) {
    const ExRect &r = morphEx[k];
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
  }
  return false;
}

static void allocMorph() {
  size_t n = FRAME_PIXELS * sizeof(uint16_t);
  bool ps = psramFound();
  snapA  = (uint16_t *)malloc(FRAME_BYTES);
  snapB  = (uint16_t *)malloc(FRAME_BYTES);
  morphA = (uint16_t *)(ps ? heap_caps_malloc(n, MALLOC_CAP_SPIRAM) : malloc(n));
  morphB = (uint16_t *)(ps ? heap_caps_malloc(n, MALLOC_CAP_SPIRAM) : malloc(n));
  morphReady = snapA && snapB && morphA && morphB;
}

static inline void snapshotCanvas(uint16_t *dst) { memcpy(dst, matrix.getBuffer(), FRAME_BYTES); }

// Pixels lit in both frames stay put (colour cross-fade); only pixels that
// differ travel, paired in scan order.
static bool buildMorph(const ExRect *ex = nullptr, int exCount = 0) {
  morphEx = ex;
  morphExCount = ex ? exCount : 0;
  morphNA = morphNB = 0;
  for (int i = 0; i < FRAME_PIXELS; i++) {
    if (morphExCount && inExcluded(i)) continue;
    bool inA = snapA[i] != 0, inB = snapB[i] != 0;
    if (inA && !inB) morphA[morphNA++] = i;
    else if (inB && !inA) morphB[morphNB++] = i;
  }
  morphCount = (morphNA && morphNB) ? max(morphNA, morphNB) : 0;
  return true;
}

static inline uint16_t lerp565(uint16_t a, uint16_t b, int e256) {
  int ar = (a >> 11) & 0x1F, ag = (a >> 5) & 0x3F, ab = a & 0x1F;
  int br = (b >> 11) & 0x1F, bg = (b >> 5) & 0x3F, bb = b & 0x1F;
  int r = ar + (((br - ar) * e256) >> 8);
  int g = ag + (((bg - ag) * e256) >> 8);
  int bl = ab + (((bb - ab) * e256) >> 8);
  return (uint16_t)((r << 11) | (g << 5) | bl);
}

static float easeInOut(float t) {
  return t < 0.5f ? 4 * t * t * t : 1 - powf(-2 * t + 2, 3) / 2;
}

static void drawMorph(int e256) {
  matrix.fillScreen(0);
  uint16_t *buf = matrix.getBuffer();
  // static pixels: lit in both, colour cross-fades; excluded regions cut straight to B
  for (int i = 0; i < FRAME_PIXELS; i++) {
    if (morphExCount && inExcluded(i)) { buf[i] = snapB[i]; continue; }
    if (snapA[i] && snapB[i]) buf[i] = lerp565(snapA[i], snapB[i], e256);
  }
  if (morphCount == 0) {
    // one side has nothing to pair with: fade the leftovers in place
    for (int k = 0; k < morphNA; k++) { int i = morphA[k]; buf[i] = lerp565(snapA[i], 0, e256); }
    for (int k = 0; k < morphNB; k++) { int i = morphB[k]; buf[i] = lerp565(0, snapB[i], e256); }
    return;
  }
  for (int k = 0; k < morphCount; k++) {
    int a = morphA[(uint32_t)k * morphNA / morphCount];
    int b = morphB[(uint32_t)k * morphNB / morphCount];
    int ax = a & (WIDTH - 1), ay = a / WIDTH;
    int bx = b & (WIDTH - 1), by = b / WIDTH;
    int x = ax + (((bx - ax) * e256 + 128) >> 8);
    int y = ay + (((by - ay) * e256 + 128) >> 8);
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) continue;
    buf[y * WIDTH + x] = lerp565(snapA[a], snapB[b], e256);
  }
}

// Clock render with a short pixel-morph when the minute ticks over, so the
// digits re-flow into their new widths instead of snapping.
static const uint32_t TICK_MORPH_MS = 500;
static int lastClockMinute = -1;

static void renderClock(uint8_t alpha) {
  struct tm info;
  bool ok = getLocalTimeSafe(&info);
  if (ok && alpha == 255 && morphReady && lastClockMinute >= 0 && info.tm_min != lastClockMinute) {
    snapshotCanvas(snapA);          // the :59 frame still in the canvas
    drawClock(255);
    snapshotCanvas(snapB);          // the new minute
    if (buildMorph()) {
      uint32_t t0 = millis();
      for (;;) {
        uint32_t dt = millis() - t0;
        if (dt >= TICK_MORPH_MS) break;
        drawMorph((int)(easeInOut(dt / (float)TICK_MORPH_MS) * 256));
        matrix.show();
        delay(8);
      }
      matrix.drawRGBBitmap(0, 0, snapB, WIDTH, HEIGHT);
    }
    matrix.show();
    lastClockMinute = info.tm_min;
    return;
  }
  drawClock(alpha);
  matrix.show();
  if (ok) lastClockMinute = info.tm_min;
}

// ── HTTP ─────────────────────────────────────────────────────────
static String apiUrl(const String &path) {
  String u = String(SERVER_BASE_URL) + path;
  u += (path.indexOf('?') >= 0) ? "&" : "?";
  u += "deviceId=";
  u += deviceId;
  return u;
}

static bool httpGetString(HTTPClient &http, const String &url, String &out) {
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setConnectTimeout(4000);
  if (!http.begin(url)) return false;
  int code = http.GET();
  if (code != 200) { Serial.printf("GET %s -> %d\n", url.c_str(), code); http.end(); return false; }
  out = http.getString();
  http.end();
  return true;
}

// Fetch one RGB565 big-endian frame straight into dst.
static bool httpGetFrame(HTTPClient &http, const String &url, uint16_t *dst) {
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setConnectTimeout(4000);
  if (!http.begin(url)) return false;
  int code = http.GET();
  if (code != 200) { http.end(); return false; }
  int len = http.getSize();
  if (len > 0 && len != (int)FRAME_BYTES) { http.end(); return false; }

  WiFiClient *s = http.getStreamPtr();
  uint8_t buf[512];
  size_t got = 0;
  uint32_t deadline = millis() + HTTP_TIMEOUT_MS;
  uint8_t *out = (uint8_t *)dst;
  while (got < FRAME_BYTES) {
    if (millis() > deadline) { http.end(); return false; }
    size_t avail = s->available();
    if (!avail) { if (!s->connected()) { http.end(); return false; } delay(1); continue; }
    size_t n = s->readBytes(buf, min(avail, min(sizeof(buf), FRAME_BYTES - got)));
    memcpy(out + got, buf, n);
    got += n;
  }
  http.end();
  // big-endian on the wire -> native uint16
  for (int i = 0; i < FRAME_PIXELS; i++) dst[i] = (uint16_t)(out[i * 2] << 8) | out[i * 2 + 1];
  return true;
}

// Load bitmap `name` (meta + frames) into a pool. Runs on either core.
static bool loadBitmapInto(FramePool &p, const char *name) {
  p.ready = false;
  p.count = 0;
  HTTPClient http;
  http.setReuse(true);

  String meta;
  if (!httpGetString(http, apiUrl(String("/api/bitmap/") + name), meta)) return false;

  JsonDocument doc;
  if (deserializeJson(doc, meta)) return false;
  int count = doc["count"] | 0;
  uint32_t delayMs = doc["frameDelayMs"] | 0;
  if (count <= 0) return false;
  p.exCount = 0;
  for (JsonObject r : doc["morphExclude"].as<JsonArray>()) {
    if (p.exCount >= 4) break;
    p.ex[p.exCount++] = { (uint8_t)(r["x"] | 0), (uint8_t)(r["y"] | 0), (uint8_t)(r["w"] | 0), (uint8_t)(r["h"] | 0) };
  }
  if (count > MAX_FRAMES) count = MAX_FRAMES;

  for (int i = 0; i < count; i++) {
    String url = apiUrl(String("/api/bitmap/") + name + "/" + String(i) + ".bin");
    if (!httpGetFrame(http, url, poolFrame(p, i))) {
      Serial.printf("frame %d of %s failed\n", i, name);
      return false;
    }
  }
  p.count = count;
  p.frameDelayMs = delayMs;
  strlcpy(p.name, name, sizeof(p.name));
  p.loadedAt = millis();
  p.ready = true;
  return true;
}

// ── BACKGROUND FETCH TASK (core 0) ───────────────────────────────
struct FetchJob {
  volatile bool pending;
  volatile bool busy;
  volatile bool ok;
  int  poolIdx;
  char name[24];
};
static FetchJob job = {};

static void fetchTask(void *) {
  for (;;) {
    if (job.pending) {
      job.pending = false;
      job.busy = true;
      job.ok = loadBitmapInto(pools[job.poolIdx], job.name);
      Serial.printf("[fetch] %s -> %s (%d frames)\n", job.name, job.ok ? "ok" : "FAIL", pools[job.poolIdx].count);
      job.busy = false;
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

static void requestPrefetch(int poolIdx, const char *name) {
  if (job.busy || job.pending) return;
  job.poolIdx = poolIdx;
  strlcpy(job.name, name, sizeof(job.name));
  job.ok = false;
  job.pending = true;
}

static void waitForFetchIdle(uint32_t maxMs) {
  uint32_t t0 = millis();
  while ((job.busy || job.pending) && millis() - t0 < maxMs) delay(10);
}

// ── MANIFEST ─────────────────────────────────────────────────────
static bool parseManifest(const String &json, Config &out) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return false;
  if ((doc["v"] | 0) != 2) return false;

  setDefaultConfig(out);
  out.pollMs = max((uint32_t)15000, (uint32_t)(doc["pollMs"] | 60000));
  strlcpy(out.tz, doc["tz"] | "AEST-10", sizeof(out.tz));
  out.brightDay   = doc["bright"]["day"]   | 200;
  out.brightNight = doc["bright"]["night"] | 26;
  out.nightStart  = doc["bright"]["nightStart"] | 22;
  out.nightEnd    = doc["bright"]["nightEnd"]   | 7;
  out.otaEnabled  = doc["ota"]["enabled"] | false;
  out.otaAuto     = doc["ota"]["auto"]    | false;
  strlcpy(out.otaVersion, doc["ota"]["version"] | "", sizeof(out.otaVersion));
  strlcpy(out.otaUrl,     doc["ota"]["url"]     | "", sizeof(out.otaUrl));
  strlcpy(out.rev,        doc["rev"]            | "?", sizeof(out.rev));

  out.pageCount = 0;
  for (JsonObject p : doc["pages"].as<JsonArray>()) {
    if (out.pageCount >= MAX_PAGES) break;
    Page &pg = out.pages[out.pageCount];
    memset(&pg, 0, sizeof(pg));
    const char *type = p["type"] | "";
    if (!strcmp(type, "CLOCK")) {
      pg.type = PAGE_CLOCK;
      strlcpy(pg.name, "clock", sizeof(pg.name));
      pg.durationMs = p["durationMs"] | 10000;
    } else if (!strcmp(type, "BITMAP")) {
      const char *name = p["name"] | "";
      if (!*name) continue;
      pg.type = PAGE_BITMAP;
      strlcpy(pg.name, name, sizeof(pg.name));
      pg.loops = max(1, (int)(p["loops"] | 1));
      pg.frameDelayMs = p["frameDelayMs"] | 450;
      pg.durationMs = p["durationMs"] | 0;
      pg.holdMs = p["holdMs"] | 0;
      pg.morph = p["morph"] | false;
    } else if (!strcmp(type, "TIMER")) {
      pg.type = PAGE_TIMER;
      strlcpy(pg.name, "timer", sizeof(pg.name));
      pg.endsAt = p["endsAt"] | 0;
      pg.durationMs = 0;
    } else continue;
    out.pageCount++;
  }
  if (out.pageCount == 0) {
    out.pageCount = 1;
    out.pages[0].type = PAGE_CLOCK;
    out.pages[0].durationMs = 10000;
    strlcpy(out.pages[0].name, "clock", sizeof(out.pages[0].name));
  }
  return true;
}

static uint32_t lastPoll = 0;
static bool     lastPollOk = false;
static int      curPage = 0;

static void applyTimezone(const char *tz) {
  configTzTime(tz, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
}

static bool fetchManifest() {
  HTTPClient http;
  String body;
  if (!httpGetString(http, apiUrl("/api/manifest"), body)) return false;
  Config next;
  if (!parseManifest(body, next)) { Serial.println("manifest parse failed"); return false; }

  bool tzChanged = strcmp(next.tz, cfg.tz) != 0;
  bool changed = strcmp(next.rev, cfg.rev) != 0;
  if (changed || !cfgFromServer) {
    cfg = next;
    cfgFromServer = true;
    if (curPage >= cfg.pageCount) curPage = 0;
    Serial.printf("manifest rev %s: %d pages, poll %lus, bright %d/%d (%d-%d)\n",
                  cfg.rev, cfg.pageCount, (unsigned long)(cfg.pollMs / 1000),
                  cfg.brightDay, cfg.brightNight, cfg.nightStart, cfg.nightEnd);
    if (tzChanged) applyTimezone(cfg.tz);
  }
  return true;
}

static void sendHeartbeat() {
  HTTPClient http;
  http.setTimeout(4000);
  http.setConnectTimeout(3000);
  if (!http.begin(String(SERVER_BASE_URL) + "/api/device/heartbeat")) return;
  http.addHeader("Content-Type", "application/json");
  JsonDocument doc;
  doc["deviceId"]    = deviceId;
  doc["fw"]          = FW_VERSION;
  doc["board"]       = BOARD_NAME;
  doc["uptimeS"]     = millis() / 1000;
  doc["rssi"]        = WiFi.RSSI();
  doc["heapFree"]    = ESP.getFreeHeap();
  doc["psramFree"]   = ESP.getFreePsram();
  doc["page"]        = cfg.pages[curPage].name;
  doc["manifestRev"] = cfg.rev;
  doc["bright"]      = scheduledBright;
  String body;
  serializeJson(doc, body);
  http.POST(body);
  http.end();
}

// ── OTA ──────────────────────────────────────────────────────────
static char     otaTriedVersion[24] = "";
static uint32_t otaTriedAt = 0;

static void maybeOta() {
  if (!cfg.otaEnabled || !cfg.otaAuto || !cfg.otaUrl[0] || !cfg.otaVersion[0]) return;
  if (!strcmp(cfg.otaVersion, FW_VERSION)) return;
  if (!strcmp(cfg.otaVersion, otaTriedVersion) && millis() - otaTriedAt < OTA_RETRY_MS) return;

  strlcpy(otaTriedVersion, cfg.otaVersion, sizeof(otaTriedVersion));
  otaTriedAt = millis();
  Serial.printf("OTA: %s -> %s from %s\n", FW_VERSION, cfg.otaVersion, cfg.otaUrl);
  showStatus("UPDATING", cfg.otaVersion, "don't unplug", col(255, 120, 0));
  waitForFetchIdle(HTTP_TIMEOUT_MS + 2000);

  WiFiClient client;
  httpUpdate.rebootOnUpdate(true);
  t_httpUpdate_return ret = httpUpdate.update(client, cfg.otaUrl);
  if (ret == HTTP_UPDATE_FAILED) {
    Serial.printf("OTA failed: %s\n", httpUpdate.getLastErrorString().c_str());
    showStatus("OTA FAILED", httpUpdate.getLastErrorString().c_str(), nullptr, col(227, 0, 15));
    delay(3000);
  }
}

// ── WIFI ─────────────────────────────────────────────────────────
static uint32_t wifiLostAt = 0;

static bool ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) { wifiLostAt = 0; return true; }
  uint32_t now = millis();
  if (!wifiLostAt) { wifiLostAt = now; WiFi.reconnect(); Serial.println("wifi lost, reconnecting"); }
  else if (now - wifiLostAt > WIFI_GIVEUP_MS) { Serial.println("wifi down too long, rebooting"); ESP.restart(); }
  return false;
}

// ── PLAYER STATE MACHINE ─────────────────────────────────────────
enum Phase : uint8_t { PH_MORPH, PH_SHOW };

static Phase    phase = PH_SHOW;
static uint32_t tPhase = 0;
static int      curPool = -1;      // pool index for the current BITMAP page
static int      frameIdx = 0;
static int      loopIdx = 0;
static uint32_t tNextFrame = 0;
static uint32_t curFrameDelay = 450;
static bool     prefetchArmed = false;
static bool     holdingLast = false;
static uint8_t  pageFailStreak = 0;

static inline Page &page() { return cfg.pages[curPage]; }
static inline bool singlePage() { return cfg.pageCount <= 1; }

static int nextPageIndex(int from) { return (from + 1) % cfg.pageCount; }

static int findReadyPool(const char *name) {
  int best = -1;
  for (int i = 0; i < poolCount; i++) {
    if (!pools[i].ready || strcmp(pools[i].name, name)) continue;
    if (best < 0 || (int32_t)(pools[i].loadedAt - pools[best].loadedAt) > 0) best = i;
  }
  return best;
}

// Make sure the page's bitmap is in a pool. Returns pool index or -1.
static int ensureLoaded(Page &pg) {
  // Was it prefetched?
  waitForFetchIdle(HTTP_TIMEOUT_MS * 2);
  int idx = findReadyPool(pg.name);
  if (idx >= 0) return idx;

  // Pick a pool that isn't the one currently on screen (if we have two).
  int target = (poolCount > 1 && curPool == 0) ? 1 : 0;
  if (poolCount == 1) target = 0;
  if (loadBitmapInto(pools[target], pg.name)) return target;
  return -1;
}

static void armPrefetchForNext() {
  if (prefetchArmed || poolCount < 2) return;
  prefetchArmed = true;
  // find the next BITMAP page after the current one
  int idx = curPage;
  for (int n = 0; n < cfg.pageCount; n++) {
    idx = nextPageIndex(idx);
    if (cfg.pages[idx].type == PAGE_BITMAP) {
      const char *name = cfg.pages[idx].name;
      int have = findReadyPool(name);
      // Already prefetched during an earlier page (and not the copy on screen)? Keep it.
      if (have >= 0 && have != curPool && millis() - pools[have].loadedAt < 120000) return;
      int other = (curPool == 0) ? 1 : 0;
      requestPrefetch(other, name);
      return;
    }
  }
}

static void enterShow(uint32_t now) {
  phase = PH_SHOW;
  tPhase = now;
  frameIdx = 0;
  loopIdx = 0;
  tNextFrame = now;
  prefetchArmed = false;
  holdingLast = false;
}

static void startPage(int idx, uint32_t now) {
  curPage = idx;
  Page &pg = page();
  if (pg.type == PAGE_BITMAP) {
    int p = ensureLoaded(pg);
    if (p < 0) {
      Serial.printf("page %s unavailable, skipping\n", pg.name);
      if (++pageFailStreak >= cfg.pageCount) {
        // Nothing loadable right now: curPool = -1 makes the player show the
        // clock in this slot for ~15 s, then it tries the playlist again.
        pageFailStreak = 0;
        curPool = -1;
        return;
      }
      startPage(nextPageIndex(idx), now);
      return;
    }
    curPool = p;
    curFrameDelay = pg.frameDelayMs ? pg.frameDelayMs : pools[p].frameDelayMs;   // 0 = use the asset's own timing
    if (curFrameDelay < 50) curFrameDelay = 450;
  } else {
    curPool = -1;
  }
  pageFailStreak = 0;
  lastClockMinute = -1;
  Serial.printf("[page] %s\n", pg.name);
}

static void drawCurrent(uint8_t alpha, int frame) {
  if (page().type == PAGE_BITMAP && curPool >= 0) drawBitmap(pools[curPool], frame, alpha);
  else if (page().type == PAGE_TIMER) drawTimer(alpha);
  else drawClock(alpha);
}

// Snapshot what's on screen, load the next page, and morph into its first frame.
static void beginTransition(int nextIdx, uint32_t now) {
  snapshotCanvas(snapA);
  startPage(nextIdx, now);
  drawCurrent(255, 0);
  snapshotCanvas(snapB);
  if (morphReady && buildMorph()) {
    phase = PH_MORPH;
    tPhase = now;
  } else {
    matrix.show();
    enterShow(now);
  }
}

static void maybePoll(uint32_t now, bool force) {
  uint32_t interval = lastPollOk ? cfg.pollMs : 20000;
  if (!force && now - lastPoll < interval) return;
  lastPoll = now;
  if (!ensureWifi()) { lastPollOk = false; return; }
  lastPollOk = fetchManifest();
  sendHeartbeat();
  maybeOta();
}

// ── SETUP / LOOP ─────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.printf("\nweatherclock %s (%s)\n", FW_VERSION, BOARD_NAME);

  setDefaultConfig(cfg);

  ProtomatterStatus st = matrix.begin();
  if (st != PROTOMATTER_OK) {
    Serial.printf("Protomatter error %d\n", st);
    for (;;) delay(1000);
  }
  matrix.fillScreen(0);
  matrix.show();

  allocPools();
  allocMorph();
  if (poolCount == 0 || !fadeTmp) {
    showStatus("NO MEMORY", "for frames", nullptr, col(227, 0, 15));
    for (;;) delay(1000);
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  initDeviceId();
  showStatus("WIFI...", WIFI_SSID, deviceId);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) delay(200);

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("wifi ok %s rssi %d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    showStatus("ONLINE", WiFi.localIP().toString().c_str(), deviceId, col(30, 200, 80));
  } else {
    Serial.println("wifi failed, continuing offline");
    showStatus("NO WIFI", "retrying...", deviceId, col(227, 0, 15));
  }

  applyTimezone(cfg.tz);
  uint32_t ts = millis();
  while (time(nullptr) < 1700000000 && millis() - ts < 8000) delay(200);

  xTaskCreatePinnedToCore(fetchTask, "fetch", 12288, nullptr, 1, nullptr, 0);

  maybePoll(millis(), true);
  updateScheduledBright();
  startPage(0, millis());
  enterShow(millis());
}

void loop() {
  const uint32_t now = millis();
  updateScheduledBright();

  Page &pg = page();
  const bool isClock = (pg.type != PAGE_BITMAP) || curPool < 0;

  switch (phase) {
    case PH_MORPH: {
      uint32_t dt = now - tPhase;
      if (dt >= MORPH_MS) {
        matrix.drawRGBBitmap(0, 0, snapB, WIDTH, HEIGHT);
        matrix.show();
        enterShow(now);
        break;
      }
      drawMorph((int)(easeInOut(dt / (float)MORPH_MS) * 256));
      matrix.show();
      delay(8);
    } break;

    case PH_SHOW: {
      if (!prefetchArmed) armPrefetchForNext();

      if (pg.type == PAGE_TIMER) {
        drawTimer(255);
        matrix.show();
        maybePoll(now, false);
        if (!singlePage() && now - tPhase >= 15000) beginTransition(nextPageIndex(curPage), now);
        delay(CLOCK_TICK_MS);
        break;
      }

      if (isClock) {
        renderClock(255);
        maybePoll(now, false);                       // cheap moment to talk to the server
        uint32_t dur = pg.type == PAGE_CLOCK ? pg.durationMs : 15000;
        if (now - tPhase >= dur) {
          if (!singlePage())              beginTransition(nextPageIndex(curPage), now);
          else if (pg.type == PAGE_BITMAP) { startPage(curPage, now); enterShow(now); }   // lone bitmap page failed earlier: retry
        }
        delay(CLOCK_TICK_MS);
        break;
      }

      FramePool &pool = pools[curPool];
      if (now >= tNextFrame) {
        if (frameIdx >= pool.count) {
          frameIdx = 0;
          loopIdx++;
          bool done = loopIdx >= pg.loops;
          if (pg.durationMs && now - tPhase >= pg.durationMs) done = true;
          if (done && pg.holdMs && !holdingLast) {
            // hold the finished composition before moving on
            holdingLast = true;
            frameIdx = pool.count - 1;
            tNextFrame = now + pg.holdMs;
            break;
          }
          if (done) {
            if (singlePage()) {                        // single bitmap page: loop forever, refreshing
              loopIdx = 0;
              int fresh = findReadyPool(pg.name);
              if (fresh >= 0) curPool = fresh;
              prefetchArmed = false;
            }
            else { beginTransition(nextPageIndex(curPage), now); break; }
          }
        }
        if (pg.morph && morphReady && frameIdx > 0 && pool.count > 1 && !holdingLast) {
          // morph from the frame on screen into the next one
          uint32_t ms = min((uint32_t)400, curFrameDelay * 2 / 3);
          snapshotCanvas(snapA);
          drawBitmap(pool, frameIdx, 255);
          snapshotCanvas(snapB);
          if (buildMorph(pool.ex, pool.exCount)) {
            uint32_t t0 = millis();
            for (;;) {
              uint32_t dt = millis() - t0;
              if (dt >= ms) break;
              drawMorph((int)(easeInOut(dt / (float)ms) * 256));
              matrix.show();
              delay(8);
            }
            matrix.drawRGBBitmap(0, 0, snapB, WIDTH, HEIGHT);
          }
          matrix.show();
          frameIdx++;
          tNextFrame = millis() + (curFrameDelay > ms ? curFrameDelay - ms : 50);
          break;
        }
        renderBitmap(pool, frameIdx, 255);
        frameIdx++;
        tNextFrame = now + curFrameDelay;
        if (frameIdx == 1 && loopIdx == 0) maybePoll(now, false);  // once, right after the first frame
      }
      delay(5);
    } break;

  }
}
