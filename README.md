# Weather Clock

A 64×64 HUB75 LED matrix (ESP32-S3 Matrix Portal) that shows a Mondrian clock, the local BoM rain radar, live weather, rotating quotes and messages you send from your phone. A small Node server does all the heavy lifting; the display just plays a playlist of ready-made frames.

```
┌──────────────┐   /api/manifest   ┌──────────────────────┐
│  Matrix      │ ────────────────▶ │  tsv-radar server    │──▶ BoM radar FTP
│  Portal S3   │ ◀──────────────── │  (Node + sharp)      │──▶ Open-Meteo
│  64×64 panel │  /api/bitmap/*    │  dashboard on :8787  │
└──────────────┘  heartbeat        └──────────────────────┘
```

## Layout

| Path | What |
|---|---|
| `tsv-radar/` | Server: radar + weather + quotes + messages + dashboard. Docker-ready. |
| `weatherclock/` | Firmware v2 (Arduino sketch). `board.h` picks the pin variant, `secrets.h` holds WiFi/server. |
| `weatherclock_legacy/` | The original v1 sketch, untouched, in case you want to roll back. |
| `weatherclock_copy_…aliexpressboard/` | Old duplicate of v1. Superseded by `BOARD_VARIANT 2` in `weatherclock/board.h`. |

## Server

```bash
cd tsv-radar
npm install
npm run dev          # local, uses ./manifest.json and ./content
```

Open `http://<server>:8787/` for the dashboard: radar preview, weather cards, device list, message sender and a playlist editor.

Environment (see `.env.example`): `LAT`, `LON`, `LOCATION_NAME` for the weather; `PRODUCT_ID` for the BoM radar (default `IDR1064`, Townsville); `ADMIN_TOKEN` to protect the dashboard's write actions when exposed outside the LAN.

### Deploying on the server (auto-updates from GitHub)

One-time setup on the box that runs Docker:

```bash
git clone https://github.com/71cky5p1t/weather-clock.git /opt/weather-clock
cd /opt/weather-clock/tsv-radar
cp .env.example .env      # fill in CF_TUNNEL_TOKEN, TSV_RADAR_HOST, GITHUB_WEBHOOK_SECRET
docker compose up --build -d
```

`REPO_DIR` in `.env` must match where you cloned it (default `/opt/weather-clock`).

Then in GitHub → repo **Settings → Webhooks → Add webhook**:

- Payload URL: `https://<TSV_RADAR_HOST>/hooks/deploy`
- Content type: `application/json`
- Secret: the same value as `GITHUB_WEBHOOK_SECRET`
- Events: *Just the push event*

Every push to `main` now hits the `deployer` sidecar, which verifies the HMAC signature, fast-forwards the checkout and rebuilds the `tsv-radar` container. GitHub's webhook page shows each delivery and the response, and `docker logs tsv-radar-deployer` shows the build output. If the tunnel is ever down, `deploy.sh` also works from cron as a fallback (see the header of that file).

The deployer and cloudflared containers themselves are not rebuilt by the hook. If you change them, run `docker compose up -d --build` once by hand.

### Playlist (`manifest.json`)

```json
{
  "defaults": {
    "pollMs": 60000,
    "tz": "AEST-10",
    "bright": { "day": 200, "night": 26, "nightStart": 22, "nightEnd": 7 },
    "quotes": ["Stay curious."],
    "quoteRotateMinutes": 10
  },
  "pages": [
    { "type": "RADAR",   "loops": 5, "frameDelayMs": 450 },
    { "type": "CLOCK",   "durationMs": 10000 },
    { "type": "WEATHER", "durationMs": 10000 },
    { "type": "QUOTE",   "durationMs": 7000 },
    { "type": "CONTENT", "name": "family", "loops": 2 }
  ],
  "devices": { "kitchen": { "bright": { "night": 10 }, "pages": [ ... ] } }
}
```

- `RADAR` – BoM loop. Shown only when rain is around: forecast chance ≥ `rainChanceMin` (default 30%) in the next 12 h, or rain echoes on the latest scan, or it's raining now. Set `"onlyWhenRain": false` to always show it. `WEATHER` – today card (7-seg temperature, animated icon, hi/lo/rain blocks). `PLANES` – aircraft overhead via adsb.lol; optional `lat`, `lon`, `radiusNm`, `label` per page so a device somewhere else can watch its own sky. `QUOTE` – rotates through `defaults.quotes`. `CONTENT` – any PNG/JPG/GIF/WebP dropped into `tsv-radar/content/` (name = filename without extension). `CLOCK` – rendered on the device.
- Add `"enabled": false` to park a page. Per-device overrides go under `devices.<deviceId>`.
- Messages sent from the dashboard are injected into the playlist automatically for the chosen number of minutes.
- The server skips pages whose data isn't available yet (e.g. radar before the first BoM fetch) and the dashboard tells you why.

### API the firmware uses

| Endpoint | Purpose |
|---|---|
| `GET /api/manifest?deviceId=` | Resolved playlist + brightness/tz/OTA, with a `rev` hash |
| `GET /api/bitmap/:name` | `{count, frameDelayMs}` for a bitmap page |
| `GET /api/bitmap/:name/:i.bin` | 64×64 RGB565 big-endian frame (8192 bytes) |
| `GET /api/bitmap/:name/:i.png?scale=4` | Preview (dashboard) |
| `POST /api/device/heartbeat` | Device check-in (shows up in the dashboard) |

Legacy `/frames` and `/frame/:i.bin` still work for the v1 firmware.

## Firmware

1. Copy `weatherclock/secrets.example.h` to `weatherclock/secrets.h` and fill in WiFi + server URL.
2. In `weatherclock/board.h` set `BOARD_VARIANT` to `1` (Adafruit) or `2` (AliExpress clone).
3. Board: **Adafruit MatrixPortal ESP32-S3**, PSRAM enabled. Libraries: Adafruit Protomatter ≥ 1.7.1, Adafruit GFX, ArduinoJson 7.
4. Upload.

What the device does:

- Boots, shows WiFi status and its device ID, syncs NTP, pulls the manifest.
- Plays the playlist with a pixel-morph transition: every lit pixel of the outgoing page travels to a lit pixel of the incoming one. The next bitmap page is prefetched on core 0 into PSRAM while the current one plays, so transitions don't stall.
- Clock is Flux-style: digit widths flex to fill each row (a `1` is narrow, a single-digit hour spans the whole row), minute-by-minute Mondrian colour rotation, seconds wipe.
- Re-polls the manifest every `pollMs`, sends a heartbeat (RSSI, heap, uptime, current page), and reconnects WiFi if it drops (reboots after 5 minutes offline).
- Dims between `nightStart` and `nightEnd` (wraps midnight correctly; v1 went back to full brightness at 00:00).
- Optional OTA: set `defaults.ota` (`enabled`, `auto`, `version`, `url`) and drop the `.bin` into `tsv-radar/firmware/`.

Compile from the command line with the Arduino IDE's bundled CLI:

```bash
"/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli" compile --fqbn esp32:esp32:adafruit_matrixportal_esp32s3 weatherclock
```
