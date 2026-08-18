type Metric = "lcp" | "cls" | "inp" | "fcp" | "ttfb";
type Sink = (m: { metric: Metric; value: number }) => void;

/**
 * Collects Core Web Vitals via PerformanceObserver and reports finalized
 * values. CLS is unitless and is scaled ×1000 to an integer so it buckets
 * with the same integer machinery as the ms metrics. Browser-guarded.
 */
export class SigilVitals {
  /**
   * Metrics already emitted for this page load. Every metric here is measured
   * once per load, so a second report is always a duplicate, never an update.
   */
  protected readonly reported = new Set<Metric>();

  /**
   * The largest contentful paint seen so far, reported at hidden like the
   * other accumulating metrics.
   */
  protected lcp = 0;

  /**
   * Whether {@link onLcp} has already run. LCP is dispatched once per larger
   * element, but the signal callers want is "the main content has painted",
   * which only the first one carries.
   */
  protected lcpNotified = false;

  /**
   * @param sink receives each finalized metric.
   * @param onLcp runs once, when the first LCP entry arrives. This is a
   *   *timing* signal, not a measurement — the value still goes to `sink` at
   *   hidden, where it is final. `SigilBrowserProvider` uses it to decide when
   *   the page has settled enough to talk to the server.
   */
  constructor(
    protected readonly sink: Sink,
    protected readonly onLcp?: () => void,
  ) {}

  /**
   * Records an LCP candidate and, the first time, fires {@link onLcp}.
   */
  protected noteLcp(value: number) {
    this.lcp = value;
    if (this.lcpNotified) return;
    this.lcpNotified = true;
    this.onLcp?.();
  }

  /**
   * Emits a metric, at most once per page load.
   *
   * The guard is not defensive tidying — two of the three callers fired twice
   * in production. `ttfb` arrived on every page view as two identical samples
   * milliseconds apart: `safeObserve` registers with `buffered: true`, and the
   * navigation entry is delivered both from the buffer and again when the
   * timeline dispatches it. `fcp` can do the same. And `finalize` runs on every
   * `visibilitychange` to hidden, so a visitor who tabs away twice reported
   * `lcp`/`cls`/`inp` twice.
   *
   * Dropping the later report rather than replacing the earlier one is the
   * right way round for a sink that buckets samples into a histogram: a second
   * sample is a second page, so a duplicate does not shift the percentile — it
   * inflates the population that the percentile is computed over, and one
   * visitor starts counting as two. Reporting `cls` only at the first hidden
   * does forfeit shift that accrues after a return to the tab; that is the
   * cheaper error, and the one a histogram can actually survive.
   */
  public report(metric: Metric, raw: number) {
    if (this.reported.has(metric)) return;
    this.reported.add(metric);
    const value = metric === "cls" ? Math.round(raw * 1000) : Math.round(raw);
    this.sink({ metric, value });
  }

  /**
   * Wire PerformanceObserver entry types. Guarded: no-op outside the browser
   * or when PerformanceObserver is missing. CLS + INP accumulate and are
   * finalized on visibilitychange→hidden.
   */
  public observe() {
    if (
      typeof window === "undefined" ||
      typeof PerformanceObserver === "undefined"
    )
      return;

    // FCP: paint entry "first-contentful-paint"
    this.safeObserve(["paint"], (entries) => {
      for (const e of entries) {
        if ((e as any).name === "first-contentful-paint")
          this.report("fcp", e.startTime);
      }
    });

    // LCP: last largest-contentful-paint entry wins; report on hidden.
    this.safeObserve(["largest-contentful-paint"], (entries) => {
      const last = entries[entries.length - 1];
      if (last)
        this.noteLcp(
          (last as any).renderTime || (last as any).loadTime || last.startTime,
        );
    });

    // CLS: sum of layout-shift values without recent input.
    let cls = 0;
    this.safeObserve(["layout-shift"], (entries) => {
      for (const e of entries) {
        if (!(e as any).hadRecentInput) cls += (e as any).value || 0;
      }
    });

    // INP: max event "interactionId" duration (approx — max event duration).
    let inp = 0;
    this.safeObserve(["event"], (entries) => {
      for (const e of entries) {
        const dur = (e as any).duration || 0;
        if ((e as any).interactionId && dur > inp) inp = dur;
      }
    });

    // TTFB: navigation entry responseStart. Delivered twice — once from the
    // buffer, once on dispatch — so `report` deduplicates it.
    this.safeObserve(["navigation"], (entries) => {
      const nav = entries[0] as any;
      if (nav?.responseStart) this.report("ttfb", nav.responseStart);
    });

    // Finalize accumulating metrics on hidden.
    const finalize = () => {
      if (document.visibilityState !== "hidden") return;
      if (this.lcp) this.report("lcp", this.lcp);
      this.report("cls", cls);
      if (inp) this.report("inp", inp);
    };
    document.addEventListener("visibilitychange", finalize);
  }

  protected safeObserve(types: string[], cb: (entries: any[]) => void) {
    try {
      const po = new PerformanceObserver((list) => cb(list.getEntries()));
      // buffered:true catches entries dispatched before observe() ran.
      po.observe({ type: types[0], buffered: true } as any);
    } catch {
      /* entry type unsupported in this browser — skip */
    }
  }
}
