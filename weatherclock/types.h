// types.h — shared structs. Kept in a header so the Arduino preprocessor's
// auto-generated prototypes (inserted above the sketch body) can see them.
#pragma once
#include <stdint.h>
#include "board.h"

static const int MAX_FRAMES_T = 12;
static const int MAX_PAGES_T  = 16;

enum PageType : uint8_t { PAGE_CLOCK, PAGE_BITMAP };

struct Page {
  PageType type;
  char     name[24];
  uint32_t durationMs;   // CLOCK
  uint16_t loops;        // BITMAP
  uint32_t frameDelayMs; // BITMAP (fallback if server meta lacks it)
};

struct Config {
  uint32_t pollMs;
  char     tz[40];
  uint8_t  brightDay, brightNight;
  int8_t   nightStart, nightEnd;
  bool     otaEnabled, otaAuto;
  char     otaVersion[24];
  char     otaUrl[160];
  char     rev[16];
  Page     pages[MAX_PAGES_T];
  int      pageCount;
};

struct FramePool {
  uint16_t *data;
  int       count;
  uint32_t  frameDelayMs;
  char      name[24];
  uint32_t  loadedAt;
  volatile bool ready;
};

