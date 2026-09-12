// lib/timer.js
// A kitchen timer set from the dashboard. While it runs the display shows
// nothing else: the firmware renders the countdown live (MM over SS in the
// clock's digits), so the server only hands over the end time.

export const timer = { endsAt: 0, label: "", setAt: 0 };
const LINGER_MS = 30000; // keep the finished timer on screen this long

export function setTimer(minutes, label = "") {
  const m = Math.max(0.1, Math.min(24 * 60, Number(minutes) || 0));
  timer.endsAt = Date.now() + Math.round(m * 60000);
  timer.label = String(label || "").trim().slice(0, 10);
  timer.setAt = Date.now();
  return timer;
}

export function clearTimer() {
  timer.endsAt = 0;
  timer.label = "";
  timer.setAt = 0;
}

export function timerActive() {
  return timer.endsAt > 0 && Date.now() < timer.endsAt + LINGER_MS;
}

export function timerState() {
  if (!timerActive()) return { active: false };
  return { active: true, endsAt: timer.endsAt, label: timer.label, remainingS: Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000)), done: Date.now() >= timer.endsAt };
}
