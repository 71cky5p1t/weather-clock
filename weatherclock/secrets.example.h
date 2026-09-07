// secrets.example.h — copy to secrets.h and fill in.
// secrets.h is git-ignored so credentials stay out of the repo.

#pragma once

#define WIFI_SSID        "your-wifi-name"
#define WIFI_PASS        "your-wifi-password"

// Where the tsv-radar server lives. No trailing slash.
#ifndef SERVER_BASE_URL
#define SERVER_BASE_URL  "http://192.168.1.18:8787"
#endif

// Optional. If left undefined the device uses "mp-" + the last 3 bytes of its
// MAC address. Use this to give a display a per-device playlist in manifest.json.
// #define DEVICE_ID     "kitchen"
