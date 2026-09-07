// lib/devices.js
// In-memory registry of displays that have checked in.

export const devices = new Map(); // id -> record

export function heartbeat(id, info = {}, ip = "") {
  const rec = devices.get(id) || { id, firstSeen: Date.now() };
  Object.assign(rec, {
    lastSeen: Date.now(),
    ip,
    fw: String(info.fw || rec.fw || ""),
    board: String(info.board || rec.board || ""),
    uptimeS: Number(info.uptimeS ?? rec.uptimeS ?? 0),
    rssi: Number(info.rssi ?? rec.rssi ?? 0),
    heapFree: Number(info.heapFree ?? rec.heapFree ?? 0),
    psramFree: Number(info.psramFree ?? rec.psramFree ?? 0),
    page: String(info.page || rec.page || ""),
    manifestRev: String(info.manifestRev || rec.manifestRev || ""),
    bright: Number(info.bright ?? rec.bright ?? 0),
  });
  devices.set(id, rec);
  return rec;
}

export function listDevices(onlineWindowMs = 5 * 60 * 1000) {
  const now = Date.now();
  return Array.from(devices.values())
    .map((d) => ({ ...d, online: now - d.lastSeen < onlineWindowMs, ageS: Math.round((now - d.lastSeen) / 1000) }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}
