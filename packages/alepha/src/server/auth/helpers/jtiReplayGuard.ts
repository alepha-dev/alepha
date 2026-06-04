/**
 * Single-use guard for short-lived assertion `jti`s. Bounded + self-pruning so
 * it can't grow without limit in a long-lived process. Best-effort per-instance
 * (assertions are also `aud`-bound + ~60s TTL, so a cross-isolate replay window
 * is tiny); use a shared store if you need a hard cross-instance guarantee.
 */
export class JtiReplayGuard {
  protected readonly seen = new Map<string, number>(); // jti -> expiry epoch ms

  constructor(
    protected readonly ttlMs = 120_000,
    protected readonly maxEntries = 10_000,
  ) {}

  /** Records `jti` and returns true if fresh; false if already used (replay). */
  check(jti: string, now: number = Date.now()): boolean {
    this.prune(now);
    if (this.seen.has(jti)) {
      return false;
    }
    this.seen.set(jti, now + this.ttlMs);
    return true;
  }

  protected prune(now: number): void {
    for (const [k, exp] of this.seen) {
      if (exp <= now) {
        this.seen.delete(k);
      }
    }
    // Hard cap: if still over budget after dropping expired, evict oldest-first
    // (Map preserves insertion order).
    while (this.seen.size >= this.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.seen.delete(oldest);
    }
  }
}
