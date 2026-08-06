type View = { path: string; ts: number };
type ErrEvt = {
  name: string;
  message: string;
  stack: string;
  sourceUrl: string;
  origin?: "client";
};
type Vital = { path: string; metric: string; value: number; ts: number };
type Envelope = { views?: View[]; errors?: ErrEvt[]; vitals?: Vital[] };

/**
 * Browser-side batcher: accumulates pageviews, client errors, and vitals,
 * and flushes them as ONE envelope (debounced, plus an explicit flush on
 * pagehide). Draining on flush makes a double-flush a no-op.
 */
export class SigilQueue {
  protected views: View[] = [];
  protected errors: ErrEvt[] = [];
  protected vitals: Vital[] = [];
  protected timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    protected readonly send: (env: Envelope) => Promise<void>,
    protected readonly opts: { debounceMs: number } = { debounceMs: 5000 },
  ) {}

  addView(path: string, ts: number) {
    this.push(this.views, { path, ts }, 50);
  }
  addError(e: ErrEvt) {
    this.push(this.errors, e, 20);
  }
  addVital(v: Vital) {
    this.push(this.vitals, v, 50);
  }

  protected push<T>(arr: T[], item: T, cap: number) {
    if (arr.length < cap) arr.push(item);
    this.schedule();
  }

  protected schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flush(), this.opts.debounceMs);
  }

  public async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.views.length && !this.errors.length && !this.vitals.length)
      return;
    const env: Envelope = {};
    if (this.views.length) env.views = this.views.splice(0);
    if (this.errors.length) env.errors = this.errors.splice(0);
    if (this.vitals.length) env.vitals = this.vitals.splice(0);
    await this.send(env).catch(() => {});
  }

  /**
   * Exposes pending view paths for the browser provider's debug/tests.
   */
  public pendingViews(): string[] {
    return this.views.map((v) => v.path);
  }
}
