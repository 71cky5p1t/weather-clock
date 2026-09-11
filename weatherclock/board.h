// board.h — pin configuration per board variant.
//
// Both units run on an ESP32-S3 "Matrix Portal" style board driving a 64x64
// HUB75 panel. Pick the variant you are flashing:
//
//   1 = Adafruit Matrix Portal S3 (official)
//   2 = AliExpress Matrix Portal S3 clone
//
// The only difference between the two is the RGB data pin order: the clone
// has R and B swapped on both halves. Wrong variant = red/blue swapped colours.

#pragma once
#include <stdint.h>

#ifndef BOARD_VARIANT
#define BOARD_VARIANT 1
#endif

#define MATRIX_WIDTH   64
#define MATRIX_HEIGHT  64
#define MATRIX_BITDEPTH 5
#define MATRIX_CHAINS   1

#if BOARD_VARIANT == 1
  #define BOARD_NAME "matrixportal-s3"
  static uint8_t RGB_PINS[]  = {42, 41, 40, 38, 39, 37};   // R1 G1 B1 R2 G2 B2 (Adafruit official)
  static uint8_t ADDR_PINS[] = {45, 36, 48, 35, 21};       // A B C D E
  static const uint8_t CLOCK_PIN = 2, LATCH_PIN = 47, OE_PIN = 14;

#elif BOARD_VARIANT == 2
  #define BOARD_NAME "matrixportal-s3-clone"
  static uint8_t RGB_PINS[]  = {40, 41, 42, 37, 39, 38};   // R1 G1 B1 R2 G2 B2 (clone: R/B swapped)
  static uint8_t ADDR_PINS[] = {45, 36, 48, 35, 21};
  static const uint8_t CLOCK_PIN = 2, LATCH_PIN = 47, OE_PIN = 14;

#else
  #error "Unknown BOARD_VARIANT"
#endif

#if   MATRIX_HEIGHT == 16
  #define NUM_ADDR_PINS 3
#elif MATRIX_HEIGHT == 32
  #define NUM_ADDR_PINS 4
#elif MATRIX_HEIGHT == 64
  #define NUM_ADDR_PINS 5
#else
  #error "Unsupported MATRIX_HEIGHT"
#endif
