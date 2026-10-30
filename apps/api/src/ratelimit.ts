/**
 * Fixed-window rate limits per key (an API key, or an address for sign-in).
 * Kept in memory: with several API instances this moves to Redis (spec 8.2).
 */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(readonly limit: number, readonly windowMs = 60_000) {}

  /** Count one request; returns how many remain, or the seconds to wait when over the limit. */
  hit(key: string, now = Date.now()): { ok: true; remaining: number } | { ok: false; retryAfter: number } {
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      w = { start: now, count: 0 };
      this.windows.set(key, w);
      if (this.windows.size > 50_000) this.sweep(now);
    }
    if (w.count >= this.limit) return { ok: false, retryAfter: Math.ceil((w.start + this.windowMs - now) / 1000) };
    w.count++;
    return { ok: true, remaining: this.limit - w.count };
  }

  /** Whether the key has used up its window, without counting a request. */
  over(key: string, now = Date.now()): number | null {
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs || w.count < this.limit) return null;
    return Math.ceil((w.start + this.windowMs - now) / 1000);
  }

  private sweep(now: number) {
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
  }
}
