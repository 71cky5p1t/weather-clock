#include <Adafruit_Protomatter.h>
#include <Adafruit_GFX.h>
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>

// ── MATRIX PARAMS ────────────────────────────────────────────────
#define WIDTH       64
#define HEIGHT      64
#define BIT_DEPTH    5
#define CHAINS       1

uint8_t rgbPins[] = {40,41,42, 37,39,38};
uint8_t addrPins[] = {45,36,48,35,21};
const uint8_t clockPin = 2, latchPin = 47, oePin = 14;

#if   HEIGHT == 16
  #define NUM_ADDR_PINS 3
#elif HEIGHT == 32
  #define NUM_ADDR_PINS 4
#elif HEIGHT == 64
  #define NUM_ADDR_PINS 5
#else
  #error Unsupported HEIGHT
#endif

Adafruit_Protomatter matrix(
  WIDTH, BIT_DEPTH, CHAINS,
  rgbPins, NUM_ADDR_PINS, addrPins,
  clockPin, latchPin, oePin, true
);

// ── WIFI / NTP ──────────────────────────────────────────────────
const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASSWORD";
static const char* TZ_AEST = "AEST-10"; // Brisbane (UTC+10, no DST)

// Example: "http://192.168.1.18:8787"
static const char* RADAR_BASE_URL = "http://192.168.1.18:8787";

// ── RADAR PLAYBACK CONFIG ───────────────────────────────────────
static const int MAX_FRAMES = 12;             // must be >= server NUM_FRAMES
static const int RADAR_LOOPS = 5;
static const uint32_t FRAME_DELAY_MS = 450;   // ~2.2 fps
static const uint32_t CLOCK_HOLD_MS  = 10000;
static const uint32_t FADE_MS        = 900;   // fade-out + fade-in each

// ── BRIGHTNESS SCHEDULE ─────────────────────────────────────────
static const uint8_t BRIGHT_DAY   = 200;
static const uint8_t BRIGHT_NIGHT = 26;
static const int NIGHT_START_HOUR = 22;

// Optional test override
static const bool TEST_SIMULATE_10PM = false;
static const int  TEST_HOUR = 22;
static const int  TEST_MIN  = 0;

uint8_t BRIGHT = BRIGHT_DAY;

static inline void applyBrightnessForHour(int hour24) {
  BRIGHT = (hour24 >= NIGHT_START_HOUR) ? BRIGHT_NIGHT : BRIGHT_DAY;
}
static inline void maybeOverrideTime(struct tm &info) {
  if (!TEST_SIMULATE_10PM) return;
  info.tm_hour = TEST_HOUR;
  info.tm_min  = TEST_MIN;
}

// ── CLOCK COLOR SCALING (0–255, scales all colors) ───────────────
static inline uint16_t col(uint8_t r, uint8_t g, uint8_t b) {
  uint16_t rs = (uint16_t)((uint32_t)r * BRIGHT + 127) / 255;
  uint16_t gs = (uint16_t)((uint32_t)g * BRIGHT + 127) / 255;
  uint16_t bs = (uint16_t)((uint32_t)b * BRIGHT + 127) / 255;
  return matrix.color565(rs, gs, bs);
}

// ── MONDRIAN PALETTE ────────────────────────────────────────────
uint16_t MONDRIAN_RED()    { return col(227, 0, 15); }
uint16_t MONDRIAN_BLUE()   { return col(0, 48, 135); }
uint16_t MONDRIAN_YELLOW() { return col(255, 221, 0); }
uint16_t MONDRIAN_WHITE()  { return col(240, 240, 240); }
uint16_t MONDRIAN_BLACK()  { return col(0,0,0); }
uint16_t MONDRIAN_COLON()  { return col(200,200,200); }

void paletteFromRot(int rot, uint16_t &outTL, uint16_t &outTR, uint16_t &outBRc, uint16_t &outBLc) {
  uint16_t ring[4] = { MONDRIAN_RED(), MONDRIAN_BLUE(), MONDRIAN_WHITE(), MONDRIAN_YELLOW() };
  outTL  = ring[(0 - rot + 4) & 3];
  outTR  = ring[(1 - rot + 4) & 3];
  outBRc = ring[(2 - rot + 4) & 3];
  outBLc = ring[(3 - rot + 4) & 3];
}

// ── 7-SEG DIGITS ────────────────────────────────────────────────
const uint8_t DIGIT_MASK[10] = {
  0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110,
  0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111
};

void fillRectWipe(int x, int y, int w, int h, uint16_t colorTop, uint16_t colorBottom, int yCut) {
  if (w <= 0 || h <= 0) return;
  int yEnd = y + h;
  if (yEnd <= yCut) {
    matrix.fillRect(x, y, w, h, colorTop);
  } else if (y >= yCut) {
    matrix.fillRect(x, y, w, h, colorBottom);
  } else {
    int hTop = yCut - y;                 if (hTop > 0) matrix.fillRect(x, y, w, hTop, colorTop);
    int hBot = yEnd - yCut;              if (hBot > 0) matrix.fillRect(x, yCut, w, hBot, colorBottom);
  }
}

void drawSegmentRects(int x, int y, int w, int h, uint8_t mask,
                      uint16_t colorTop, uint16_t colorBottom, int yCut) {
  int m = max(2, w / 10);
  int t = max(3, min(w, h) / 7);
  int x0 = x + m, x1 = x + w - m;
  int y0 = y + m, y1 = y + h - m;
  int mid = (y0 + y1) / 2;

  if (mask & (1 << 0)) fillRectWipe(x0, y0,         x1 - x0, t, colorTop, colorBottom, yCut); // A
  if (mask & (1 << 6)) fillRectWipe(x0, mid - t/2,  x1 - x0, t, colorTop, colorBottom, yCut); // G
  if (mask & (1 << 3)) fillRectWipe(x0, y1 - t,     x1 - x0, t, colorTop, colorBottom, yCut); // D

  bool gOn = (mask & (1 << 6)) != 0;
  int halfTop = gOn ? (mid - y0 - t/2) : (mid - y0);
  int halfBot = gOn ? (y1 - (mid + t/2)) : (y1 - mid);
  if (halfTop < 0) halfTop = 0;
  if (halfBot < 0) halfBot = 0;

  if (mask & (1 << 5)) fillRectWipe(x0,     y0,        t, halfTop, colorTop, colorBottom, yCut); // F
  if (mask & (1 << 4)) fillRectWipe(x0,     mid,       t, halfBot, colorTop, colorBottom, yCut); // E
  if (mask & (1 << 1)) fillRectWipe(x1 - t, y0,        t, halfTop, colorTop, colorBottom, yCut); // B
  if (mask & (1 << 2)) fillRectWipe(x1 - t, mid,       t, halfBot, colorTop, colorBottom, yCut); // C
}

void drawDigitInCell(uint8_t digit, int cellX, int cellY, int cellW, int cellH,
                     uint16_t colorTop, uint16_t colorBottom, int yCut) {
  if (digit > 9) digit = 0;
  drawSegmentRects(cellX, cellY, cellW, cellH, DIGIT_MASK[digit], colorTop, colorBottom, yCut);
}

void drawColonWipe(bool on, int yCut) {
  int cx = WIDTH/2 - 1;
  int topY = (HEIGHT/2) - 7;
  int botY = (HEIGHT/2) + 7;
  uint16_t c = on ? MONDRIAN_COLON() : MONDRIAN_BLACK();
  fillRectWipe(cx, topY, 2, 2, c, c, yCut);
  fillRectWipe(cx, botY, 2, 2, c, c, yCut);
}

void drawClockDigits(int hh, int mm, int ss, bool colonOn) {
  matrix.fillScreen(MONDRIAN_BLACK());

  const int cell = 32;
  int yCut = ((ss + 1) * HEIGHT) / 60;
  if (yCut < 0) yCut = 0;
  if (yCut > HEIGHT) yCut = HEIGHT;

  int rotCur  = (mm     ) & 3;
  int rotPrev = (mm + 3 ) & 3;

  uint16_t TL_cur, TR_cur, BR_cur, BL_cur;
  uint16_t TL_prev, TR_prev, BR_prev, BL_prev;
  paletteFromRot(rotCur,  TL_cur,  TR_cur,  BR_cur,  BL_cur);
  paletteFromRot(rotPrev, TL_prev, TR_prev, BR_prev, BL_prev);

  drawDigitInCell((hh / 10) % 10, 0,    0,    cell, cell, TL_cur, TL_prev, yCut);
  drawDigitInCell(hh % 10,        cell, 0,    cell, cell, TR_cur, TR_prev, yCut);
  drawDigitInCell((mm / 10) % 10, 0,    cell, cell, cell, BL_cur, BL_prev, yCut);
  drawDigitInCell(mm % 10,        cell, cell, cell, cell, BR_cur, BR_prev, yCut);

  drawColonWipe(colonOn, yCut);
}

// ── TIME HELPERS ────────────────────────────────────────────────
bool getLocalTimeSafe(struct tm* info) {
  time_t now = time(nullptr);
  if (now < 100000) return false;
  localtime_r(&now, info);
  return true;
}

// ── RADAR BUFFERS / HTTP ────────────────────────────────────────
static uint16_t radarFrames[MAX_FRAMES][WIDTH * HEIGHT];
static int radarCount = 0;
static bool radarAvailable = false;

static inline uint16_t scale565_u8(uint16_t c, uint8_t a /*0..255*/) {
  uint16_t r = (c >> 11) & 0x1F;
  uint16_t g = (c >> 5)  & 0x3F;
  uint16_t b =  c        & 0x1F;

  r = (uint16_t)((uint32_t)r * a + 127) / 255;
  g = (uint16_t)((uint32_t)g * a + 127) / 255;
  b = (uint16_t)((uint32_t)b * a + 127) / 255;

  return (r << 11) | (g << 5) | b;
}

static inline void blit565(uint16_t *frame) {
  matrix.drawRGBBitmap(0, 0, frame, WIDTH, HEIGHT);
  matrix.show();
}

static int parseCountFromJson(const String &json) {
  int idx = json.indexOf("\"count\"");
  if (idx < 0) return -1;
  idx = json.indexOf(':', idx);
  if (idx < 0) return -1;
  int end = idx + 1;
  while (end < (int)json.length() && (json[end] == ' ')) end++;
  return json.substring(end).toInt();
}

static bool httpGetString(const String &url, String &out) {
  HTTPClient http;
  http.setTimeout(5000);
  if (!http.begin(url)) return false;
  int code = http.GET();
  if (code != 200) { http.end(); return false; }
  out = http.getString();
  http.end();
  return true;
}

static bool httpGetFrameBE565(const String &url, uint16_t *dst) {
  HTTPClient http;
  http.setTimeout(8000);
  if (!http.begin(url)) return false;

  int code = http.GET();
  if (code != 200) { http.end(); return false; }

  int len = http.getSize();
  const int need = WIDTH * HEIGHT * 2;
  if (len > 0 && len != need) { http.end(); return false; }

  WiFiClient *s = http.getStreamPtr();
  int got = 0;
  while (got < need) {
    if (!s->available()) { delay(1); continue; }
    uint8_t hi = (uint8_t)s->read();
    uint8_t lo = (uint8_t)s->read();
    dst[got/2] = ((uint16_t)hi << 8) | (uint16_t)lo; // BE -> native value
    got += 2;
  }

  http.end();
  return true;
}

static bool refreshRadarFrames() {
  String j;
  if (!httpGetString(String(RADAR_BASE_URL) + "/frames", j)) {
    radarAvailable = false;
    return false;
  }

  int cnt = parseCountFromJson(j);
  if (cnt <= 0) {
    radarAvailable = false;
    return false;
  }
  if (cnt > MAX_FRAMES) cnt = MAX_FRAMES;

  for (int i = 0; i < cnt; i++) {
    String url = String(RADAR_BASE_URL) + "/frame/" + String(i) + ".bin";
    if (!httpGetFrameBE565(url, radarFrames[i])) {
      radarAvailable = false;
      return false;
    }
  }

  radarCount = cnt;
  radarAvailable = true;
  return true;
}

// Draw radar applying scheduled BRIGHT *and* an extra fade alpha
void showRadarScaled(int frameIndex, uint8_t fadeAlpha /*0..255*/) {
  static uint16_t tmp[WIDTH * HEIGHT];

  // totalAlpha = BRIGHT (schedule) * fadeAlpha
  uint16_t total = (uint16_t)((uint32_t)BRIGHT * fadeAlpha / 255);
  uint8_t totalAlpha = (total > 255) ? 255 : (uint8_t)total;

  uint16_t *src = radarFrames[frameIndex];
  for (int i = 0; i < WIDTH * HEIGHT; i++) tmp[i] = scale565_u8(src[i], totalAlpha);
  blit565(tmp);
}

// Clock fade uses alpha by scaling BRIGHT
void showClockWithFade(uint8_t alpha /*0..255*/) {
  struct tm info;
  if (!getLocalTimeSafe(&info)) return;
  maybeOverrideTime(info);

  uint8_t scheduled = (info.tm_hour >= NIGHT_START_HOUR) ? BRIGHT_NIGHT : BRIGHT_DAY;
  BRIGHT = (uint8_t)((uint32_t)scheduled * alpha / 255);

  drawClockDigits(info.tm_hour, info.tm_min, info.tm_sec, (info.tm_sec % 2) == 0);
  matrix.show();
}

// ── STATE MACHINE ───────────────────────────────────────────────
enum Mode { MODE_RADAR, MODE_FADE_TO_CLOCK, MODE_CLOCK, MODE_FADE_TO_RADAR };
static Mode mode = MODE_RADAR;

static int radarIdx = 0;
static int radarLoop = 0;
static uint32_t tNext = 0;
static uint32_t tModeStart = 0;

void setup() {
  Serial.begin(115200);

  ProtomatterStatus status = matrix.begin();
  if (status != PROTOMATTER_OK) {
    Serial.printf("Protomatter error %d\n", status);
    for(;;);
  }
  matrix.fillScreen(matrix.color565(0,0,0));
  matrix.show();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) delay(300);

  configTzTime(TZ_AEST, "pool.ntp.org", "time.google.com");
  time_t now = 0;
  uint32_t t0sync = millis();
  while ((now = time(nullptr)) < 1700000000 && millis() - t0sync < 10000) delay(200);

  // initial radar attempt
  refreshRadarFrames();

  mode = radarAvailable ? MODE_RADAR : MODE_CLOCK;
  radarIdx = 0;
  radarLoop = 0;
  tNext = millis();
  tModeStart = millis();
}

void loop() {
  const uint32_t now = millis();

  // Update scheduled BRIGHT for radar/clock (unless clock-fade is actively overriding)
  if (mode == MODE_RADAR || mode == MODE_FADE_TO_RADAR || mode == MODE_FADE_TO_CLOCK) {
    struct tm info;
    if (getLocalTimeSafe(&info)) {
      maybeOverrideTime(info);
      applyBrightnessForHour(info.tm_hour);
    } else {
      BRIGHT = BRIGHT_DAY;
    }
  }

  // Hard fallback: if radar drops, stay on clock
  if (!radarAvailable && mode != MODE_CLOCK) {
    mode = MODE_CLOCK;
    tModeStart = now;
  }

  switch (mode) {
    case MODE_RADAR: {
      if (now < tNext) break;

      if (!radarAvailable || radarCount <= 0) {
        mode = MODE_CLOCK;
        tModeStart = now;
        break;
      }

      // Always scale radar by BRIGHT (night/day)
      showRadarScaled(radarIdx, 255);

      radarIdx++;
      if (radarIdx >= radarCount) {
        radarIdx = 0;
        radarLoop++;
        if (radarLoop >= RADAR_LOOPS) {
          mode = MODE_FADE_TO_CLOCK;
          tModeStart = now;
          break;
        }
      }

      tNext = now + FRAME_DELAY_MS;
    } break;

    case MODE_FADE_TO_CLOCK: {
      if (!radarAvailable || radarCount <= 0) {
        mode = MODE_CLOCK;
        tModeStart = now;
        break;
      }

      uint32_t dt = now - tModeStart;

      if (dt < FADE_MS) {
        // fade radar out (still respects BRIGHT)
        uint8_t a = (uint8_t)(255 - (uint32_t)dt * 255 / FADE_MS);
        showRadarScaled(radarCount - 1, a);
      } else if (dt < 2 * FADE_MS) {
        // fade clock in
        uint32_t dt2 = dt - FADE_MS;
        uint8_t a = (uint8_t)((uint32_t)dt2 * 255 / FADE_MS);
        showClockWithFade(a);
      } else {
        mode = MODE_CLOCK;
        tModeStart = now;
      }
    } break;

    case MODE_CLOCK: {
      static uint32_t lastRetry = 0;

      // full clock (scheduled brightness)
      struct tm info;
      if (getLocalTimeSafe(&info)) {
        maybeOverrideTime(info);
        applyBrightnessForHour(info.tm_hour);
        drawClockDigits(info.tm_hour, info.tm_min, info.tm_sec, (info.tm_sec % 2) == 0);
        matrix.show();
      }

      // Retry radar every 30s while clock-only
      if (!radarAvailable && (now - lastRetry > 30000)) {
        lastRetry = now;
        if (refreshRadarFrames()) {
          radarIdx = 0;
          radarLoop = 0;
          tNext = now;
          mode = MODE_RADAR;
          tModeStart = now;
          break;
        }
      }

      // If radar is available and we've held the clock long enough, fade back
      if (radarAvailable && (now - tModeStart >= CLOCK_HOLD_MS)) {
        mode = MODE_FADE_TO_RADAR;
        tModeStart = now;
      }

      delay(40);
    } break;

    case MODE_FADE_TO_RADAR: {
      uint32_t dt = now - tModeStart;

      if (!radarAvailable || radarCount <= 0) {
        mode = MODE_CLOCK;
        tModeStart = now;
        break;
      }

      if (dt < FADE_MS) {
        // fade clock out
        uint8_t a = (uint8_t)(255 - (uint32_t)dt * 255 / FADE_MS);
        showClockWithFade(a);
      } else if (dt < 2 * FADE_MS) {
        // refresh frames once at transition boundary (best effort)
        if (dt == FADE_MS) {
          if (!refreshRadarFrames()) {
            mode = MODE_CLOCK;
            tModeStart = now;
            break;
          }
        }

        uint32_t dt2 = dt - FADE_MS;
        uint8_t a = (uint8_t)((uint32_t)dt2 * 255 / FADE_MS);
        showRadarScaled(0, a);
      } else {
        radarIdx = 0;
        radarLoop = 0;
        tNext = now;
        mode = MODE_RADAR;
      }
    } break;
  }
}