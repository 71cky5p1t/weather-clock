# tsv-radar — weather clock content server

See the top-level [README](../README.md) for the full picture (playlist format, API, firmware).

Quick start:

```bash
npm install
npm run dev            # http://localhost:8787
```

Docker:

```bash
docker compose up --build -d
```

Modules: `lib/radar.js` (BoM FTP + compositing), `lib/weather.js` (Open-Meteo + cards),
`lib/pixel.js` (fonts, icons, RGB565), `lib/text.js` (quotes/messages), `lib/content.js`
(user images), `lib/manifest.js` (playlist resolution), `lib/devices.js` (heartbeats),
`public/index.html` (dashboard).
