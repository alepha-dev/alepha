/**
 * What the device remembers about live updates between launches, in the
 * WebView's `localStorage`:
 *
 * - bundle versions never to fetch again (rolled back from, or failed to
 *   download twice), the 20 newest;
 * - consecutive failed checks, and when the next one may run: 1, 2, 4...
 *   minutes, capped at an hour.
 *
 * A storage that throws (private mode, a quota) only loses the memory: the
 * worst case is one more attempt.
 */
export class OtaLocalState {
  protected static readonly KEY = "alepha.capacitor.ota";
  protected static readonly MAX_EXCLUDED = 20;
  protected static readonly MAX_DELAY_MS = 60 * 60 * 1000;

  public isExcluded(version: string): boolean {
    return this.read().excluded.includes(version);
  }

  public exclude(version: string): void {
    const state = this.read();
    state.excluded = [
      ...state.excluded.filter((it) => it !== version),
      version,
    ].slice(-OtaLocalState.MAX_EXCLUDED);
    this.write(state);
  }

  /**
   * Record a failed download of `version`. True when it has now failed
   * twice and is excluded.
   */
  public downloadFailed(version: string): boolean {
    const state = this.read();
    const count = (state.downloadFailures[version] ?? 0) + 1;
    state.downloadFailures = { [version]: count };
    this.write(state);
    if (count >= 2) {
      this.exclude(version);
      return true;
    }
    return false;
  }

  public mayRetry(now: number): boolean {
    return now >= this.read().retryAt;
  }

  public failedAttempt(now: number): void {
    const state = this.read();
    state.failures++;
    state.retryAt =
      now +
      Math.min(2 ** (state.failures - 1) * 60_000, OtaLocalState.MAX_DELAY_MS);
    this.write(state);
  }

  public succeeded(): void {
    const state = this.read();
    if (state.failures === 0 && state.retryAt === 0) {
      return;
    }
    state.failures = 0;
    state.retryAt = 0;
    this.write(state);
  }

  protected read(): {
    excluded: string[];
    downloadFailures: Record<string, number>;
    failures: number;
    retryAt: number;
  } {
    const empty = {
      excluded: [],
      downloadFailures: {},
      failures: 0,
      retryAt: 0,
    };
    try {
      const raw = globalThis.localStorage?.getItem(OtaLocalState.KEY);
      return raw ? { ...empty, ...JSON.parse(raw) } : empty;
    } catch {
      return empty;
    }
  }

  protected write(state: object): void {
    try {
      globalThis.localStorage?.setItem(
        OtaLocalState.KEY,
        JSON.stringify(state),
      );
    } catch {
      // Lost memory, not a failure: see the class note.
    }
  }
}
