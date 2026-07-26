/**
 * Clock display.
 *
 * The server is authoritative but only resyncs every couple of seconds, so the countdown is
 * interpolated locally between syncs. Without that the clock would visibly jump in 2s steps.
 */

/**
 * @param {number|null} ms
 * @param {boolean} unlimited
 */
export function formatClock(ms, unlimited) {
  if (unlimited) return '∞';
  if (ms == null) return '–:––';

  const clamped = Math.max(0, ms);

  // Under ten seconds, tenths matter — that is exactly when players are watching the clock.
  if (clamped < 10000) {
    return (Math.floor(clamped / 100) / 10).toFixed(1);
  }

  const totalSeconds = Math.ceil(clamped / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

export class Clocks {
  constructor() {
    this.whiteMs = null;
    this.blackMs = null;
    this.running = false;
    this.sideToMove = 'w';
    this.unlimited = true;
    // performance.now() rather than Date.now(): immune to the system clock being adjusted.
    this.syncedAt = performance.now();
  }

  /** Accepts either a full state snapshot or a lightweight clock message. */
  sync({ whiteMs, blackMs, clockRunning, sideToMove, unlimited }) {
    if (typeof whiteMs === 'number') this.whiteMs = whiteMs;
    if (typeof blackMs === 'number') this.blackMs = blackMs;
    if (typeof clockRunning === 'boolean') this.running = clockRunning;
    if (sideToMove) this.sideToMove = sideToMove;
    if (typeof unlimited === 'boolean') this.unlimited = unlimited;
    this.syncedAt = performance.now();
  }

  /** @param {'w'|'b'} color */
  remaining(color) {
    const base = color === 'w' ? this.whiteMs : this.blackMs;
    if (base == null || this.unlimited) return base;
    if (!this.running || color !== this.sideToMove) return base;
    return Math.max(0, base - (performance.now() - this.syncedAt));
  }

  /** True when this side is under 20 seconds, for the low-time warning colour. */
  isLow(color) {
    if (this.unlimited) return false;
    const remaining = this.remaining(color);
    return remaining != null && remaining <= 20000;
  }
}
