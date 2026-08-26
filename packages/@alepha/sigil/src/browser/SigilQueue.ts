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
 * How large one envelope may get, in bytes.
 *
 * Sized against the browsers' `keepalive` cap, which is 64 KiB for the whole
 * document's in-flight keepalive bodies and is enforced by rejecting the
 * `fetch` SYNCHRONOUSLY — no status, no retry, the batch is simply gone. The
 * envelope's own caps allow far more than that: twenty errors at a 4096-byte
 * stack each is upwards of 170 KiB, so a page that threw a handful of times
 * reported nothing at all.
 *
 * 48 KiB rather than 64 leaves room for the JSON wrapper and for the gap
 * between the characters counted here and the bytes a multi-byte message
 * actually costs where `TextEncoder` is unavailable.
 */
const ENVELOPE_BUDGET = 48 * 1024;

/**
 * Bytes `item` will cost inside an envelope, comma included.
 *
 * `TextEncoder` where there is one, because `String.length` counts UTF-16
 * code units: an error message in Japanese is three bytes per character and
 * would be undercounted by two thirds.
 */
const sizeOf = (item: unknown): number => {
  const json = JSON.stringify(item);
  if (typeof TextEncoder === "undefined") return json.length + 1;
  return new TextEncoder().encode(json).length + 1;
};

/**
 * Browser-side batcher: accumulates pageviews, client errors, and vitals,
 * and flushes them as envelopes (debounced, plus an explicit flush on
 * pagehide). Draining on flush makes a double-flush a no-op.
 *
 * One flush may produce SEVERAL envelopes — see {@link ENVELOPE_BUDGET}.
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
    protected readonly send: (
      env: Envelope,
      options: { keepalive: boolean },
    ) => Promise<void>,
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
  public async release(
    options: { force?: boolean; keepalive?: boolean } = {},
  ): Promise<void> {
    this.held = false;
    await this.flush(options);
  }

  /**
   * Sends what is queued, in as many envelopes as the budget requires.
   *
   * `force` sends even when there is nothing to send. That is not a debugging
   * affordance: the response carries the current config, so an app whose
   * trackers are all switched off has no other way to hear that they were
   * switched back on. Without it, "collect nothing" would be a state a page
   * could enter and never leave.
   *
   * `keepalive` asks for a request that outlives the document, and is for the
   * flush on the way out and nothing else. It is not free: the browser caps
   * every keepalive body in the document at 64 KiB together, and refuses the
   * `fetch` synchronously past it. A debounced flush has a live page to be
   * answered on, so it uses an ordinary request and leaves the whole quota to
   * the one that genuinely races the unload.
   */
  public async flush(
    options: { force?: boolean; keepalive?: boolean } = {},
  ): Promise<void> {
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

    const envelopes = this.pack({
      views: this.views.splice(0),
      errors: this.errors.splice(0),
      vitals: this.vitals.splice(0),
      engagements: this.engagements.splice(0),
    });

    const keepalive = options.keepalive === true;
    // Sequentially: several keepalive requests in flight at once share the one
    // 64 KiB document quota, which is the very cap this split exists to stay
    // under.
    for (const env of envelopes) {
      await this.send(env, { keepalive }).catch(() => {});
    }
  }

  /**
   * Split one flush into envelopes that each fit {@link ENVELOPE_BUDGET}.
   *
   * Greedy and in order: an item goes into the envelope being filled unless it
   * would push it over, in which case a new one starts. An item larger than
   * the whole budget still gets an envelope of its own rather than looping
   * forever — the schema caps every field, so that can only be a near-maximal
   * error, and an oversized request refused by the server is a better outcome
   * than a batch dropped without one.
   *
   * Always at least one envelope, so `force` still asks the sink for its
   * config when nothing is queued.
   */
  protected pack(batch: Required<Envelope>): Envelope[] {
    const envelopes: Envelope[] = [];
    let current: Envelope = {};
    let size = 0;

    const add = <K extends keyof Envelope>(
      key: K,
      item: Required<Envelope>[K][number],
    ) => {
      const cost = sizeOf(item);
      if (size > 0 && size + cost > ENVELOPE_BUDGET) {
        envelopes.push(current);
        current = {};
        size = 0;
      }
      const bucket = (current[key] ??= [] as any) as any[];
      bucket.push(item);
      size += cost;
    };

    for (const view of batch.views) add("views", view);
    for (const engagement of batch.engagements) add("engagements", engagement);
    for (const error of batch.errors) add("errors", error);
    for (const vital of batch.vitals) add("vitals", vital);

    envelopes.push(current);
    return envelopes;
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
