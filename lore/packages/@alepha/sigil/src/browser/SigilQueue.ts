type View = {
  path: string;
  ts: number;
  referrer?: string;
  entry?: boolean;
  campaign?: string;
};
type Engagement = { path: string; ts: number };
type ErrEvt = {
  name: string;
  message: string;
  stack: string;
  sourceUrl: string;
  origin?: "client";
};
type Vital = { path: string; metric: string; value: number; ts: number };
type Envelope = {
  views?: View[];
  errors?: ErrEvt[];
  vitals?: Vital[];
  engagements?: Engagement[];
};

/**
 * Browser-side batcher: accumulates pageviews, client errors, and vitals,
 * and flushes them as ONE envelope (debounced, plus an explicit flush on
 * pagehide). Draining on flush makes a double-flush a no-op.
 */
export class SigilQueue {
  protected views: View[] = [];
  protected errors: ErrEvt[] = [];
  protected vitals: Vital[] = [];
  protected engagements: Engagement[] = [];
  protected timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Whether the debounce is suspended.
   *
   * The opening envelope of a page load is not debounce-shaped. Its producers
   * finish at different times - the view at hydration, TTFB and FCP a beat
   * later, the engagement verdict only once the visitor has had time to give
   * one - so a timer armed by the first of them sends before the last has
   * spoken, and that last one then pays for a request of its own. Holding is
   * how they leave together.
   *
   * It suspends the *timer*, not the queue. {@link flush} does not consult it,
   * so the `pagehide` and `visibilitychange` handlers still report a visitor
   * who leaves mid-hold.
   */
  protected held = false;

  constructor(
    protected readonly send: (env: Envelope) => Promise<void>,
    protected readonly opts: { debounceMs: number } = { debounceMs: 5000 },
  ) {}

  /**
   * `arrival` carries the three facts that only a page load has: where it came
   * from, what tagged it, and that it is an arrival at all. A client-side
   * navigation passes nothing — see `sigilEnvelope`.
   *
   * Absent members are omitted rather than set to `undefined`, so the JSON
   * body carries no dead keys.
   */
  addView(
    path: string,
    ts: number,
    arrival?: { referrer?: string; campaign?: string },
  ) {
    const view: View = { path, ts };
    if (arrival) {
      view.entry = true;
      if (arrival.referrer) view.referrer = arrival.referrer;
      if (arrival.campaign) view.campaign = arrival.campaign;
    }
    this.push(this.views, view, 50);
  }

  addEngagement(path: string, ts: number) {
    this.push(this.engagements, { path, ts }, 50);
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
    if (this.held) return;
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flush(), this.opts.debounceMs);
  }

  /**
   * Sends what is queued.
   *
   * `force` sends even when there is nothing to send. That is not a debugging
   * affordance: the response carries the current config, so an app whose
   * trackers are all switched off has no other way to hear that they were
   * switched back on. Without it, "collect nothing" would be a state a page
   * could enter and never leave.
   */
  /**
   * Drop what is queued for trackers that are now off.
   *
   * The gate runs at enqueue, against whatever config the page was served
   * with — and a page served from a file or a cache carries one older than the
   * visit. So the first vitals of a load are queued under the old answer and
   * would still go out afterwards, on a flush that happens after the real
   * config has arrived and said not to.
   *
   * The sink discards them either way, which is why this is not a data
   * problem. It is a request the visitor pays for to send something already
   * known to be unwanted.
   */
  public dropDisabled(enabled: Record<string, boolean>) {
    // Engagement is a fact about a view, so it follows the views gate rather
    // than having one of its own. An app that switched views off and still
    // received engagement rows would have a `sigil_views` table whose
    // `engaged` exceeded its `count`.
    if (enabled.views === false) {
      this.views.length = 0;
      this.engagements.length = 0;
    }
    if (enabled.errors === false) this.errors.length = 0;
    if (enabled.vitals === false) this.vitals.length = 0;
  }

  /**
   * Suspends the debounce until {@link release}.
   *
   * Any timer already armed is cancelled, so a caller may hold before or after
   * the first event of the load is queued and get the same answer either way.
   */
  public hold() {
    this.held = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Resumes the debounce and sends what accumulated during the hold.
   *
   * Sends rather than re-arms: a caller releases at the moment its envelope is
   * complete, and a fresh debounce window on top of that would be exactly the
   * wait this mechanism exists to remove.
   */
  public async release(options: { force?: boolean } = {}): Promise<void> {
    this.held = false;
    await this.flush(options);
  }

  public async flush(options: { force?: boolean } = {}): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (
      !options.force &&
      !this.views.length &&
      !this.errors.length &&
      !this.vitals.length &&
      !this.engagements.length
    )
      return;
    const env: Envelope = {};
    if (this.views.length) env.views = this.views.splice(0);
    if (this.errors.length) env.errors = this.errors.splice(0);
    if (this.vitals.length) env.vitals = this.vitals.splice(0);
    if (this.engagements.length) env.engagements = this.engagements.splice(0);
    await this.send(env).catch(() => {});
  }

  /**
   * Exposes pending view paths for the browser provider's debug/tests.
   */
  public pendingViews(): string[] {
    return this.views.map((v) => v.path);
  }

  /**
   * The referrer attached to each pending view, `undefined` where none was.
   *
   * Separate from {@link pendingViews} rather than folded into it: that one
   * returns bare paths and several callers already index into it positionally,
   * so widening its element type would be a change to every one of them for
   * the sake of a debug accessor.
   */
  public pendingViewReferrers(): Array<string | undefined> {
    return this.views.map((v) => v.referrer);
  }

  /**
   * Exposes the pending views' full shape for the browser provider's tests —
   * `entry` and `campaign` have no positional accessor of their own because,
   * unlike the referrer, nothing outside a test reads them individually.
   */
  public pendingViewRecords(): View[] {
    return this.views.map((v) => ({ ...v }));
  }

  public pendingEngagements(): string[] {
    return this.engagements.map((e) => e.path);
  }

  /**
   * Whether the debounce is currently suspended. Exists for the browser
   * provider's tests: a hold that is never lifted is invisible from the
   * outside until the five-second debounce that would have proved it, which is
   * not a wait a test should have to sit through.
   */
  public isHeld(): boolean {
    return this.held;
  }
}
