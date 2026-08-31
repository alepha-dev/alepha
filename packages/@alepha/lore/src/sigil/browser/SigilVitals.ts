type Metric = "lcp" | "cls" | "inp" | "fcp" | "ttfb";

/**
 * The `layout-shift` entry, which TypeScript's `lib.dom` still does not
 * declare. Kept local rather than declared globally: an ambient global in a
 * published package leaks into every consumer that compiles this source, and
 * the two fields below are all this file ever reads.
 */
interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

/**
 * `PerformanceObserverInit` plus `durationThreshold`, which the Event Timing
 * API accepts and `lib.dom` has not caught up with. Same reasoning as
 * {@link LayoutShiftEntry}: local, not global.
 */
type ObserverInit = PerformanceObserverInit & { durationThreshold?: number };
type Sink = (m: { metric: Metric; value: number; path: string }) => void;

/**
 * The path a metric belongs to, asked for at the moment the metric is
 * measured rather than at the moment it is reported.
 *
 * That distinction is the whole point. LCP, CLS and INP are finalised when the
 * page is hidden, and in a client-routed app the visitor has usually moved on
 * by then - so reading the path at report time filed the numbers of the page
 * they measured under whatever page happened to be on screen when the tab lost
 * focus.
 */
type PathResolver = () => string;

/**
 * Collects Core Web Vitals via PerformanceObserver and reports finalized
 * values. CLS is unitless and is scaled ×1000 to an integer so it buckets
 * with the same integer machinery as the ms metrics. Browser-guarded.
 */
export class SigilVitals {
  /**
   * Metric/path pairs already emitted, keyed `metric:path`.
   *
   * Keyed by both because CLS and INP are now measured PER PATH: a visitor who
   * reads three pages has three page layouts to have shifted and three sets of
   * interactions to have been slow, and one sample each is the honest reading.
   * `lcp`, `fcp` and `ttfb` still happen once, at load, so their key never
   * repeats either way.
   */
  protected readonly reported = new Set<string>();

  /**
   * The largest contentful paint seen so far, reported at hidden like the
   * other accumulating metrics, and the path it painted on.
   */
  protected lcp = 0;
  protected lcpPath?: string;

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
   * @param currentPath answers "which page is on screen right now". Supplied
   *   by the caller rather than read from `location` here, because the caller
   *   is the one that knows about client-side navigation - and because
   *   reading `location` inside a `buffered: true` observer callback can land
   *   after a navigation the entry predates.
   */
  constructor(
    protected readonly sink: Sink,
    protected readonly onLcp?: () => void,
    protected readonly currentPath: PathResolver = () =>
      typeof location === "undefined" ? "/" : location.pathname,
  ) {}

  /**
   * Records an LCP candidate and, the first time, fires {@link onLcp}.
   */
  protected noteLcp(value: number) {
    this.lcp = value;
    // The path as of the paint, not as of the report. LCP entries stop
    // arriving at the first interaction, so in practice this is the document's
    // own path - which is exactly the one it should be filed under.
    this.lcpPath ??= this.currentPath();
    if (this.lcpNotified) return;
    this.lcpNotified = true;
    this.onLcp?.();
  }

  /**
   * Emits a metric, at most once per metric AND path.
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
   *
   * The key includes the path because a second PAGE genuinely is a second
   * sample: three pages read means three layouts that could have shifted. What
   * the guard still catches is the same page reported twice, which is the
   * duplicate that inflates the population.
   */
  public report(metric: Metric, raw: number, path = this.currentPath()) {
    const key = `${metric}:${path}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    const value = metric === "cls" ? Math.round(raw * 1000) : Math.round(raw);
    this.sink({ metric, value, path });
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
    this.safeObserve<PerformancePaintTiming>("paint", (entries) => {
      for (const e of entries) {
        if (e.name === "first-contentful-paint")
          this.report("fcp", e.startTime);
      }
    });

    // LCP: last largest-contentful-paint entry wins; report on hidden.
    this.safeObserve<LargestContentfulPaint>(
      "largest-contentful-paint",
      (entries) => {
        const last = entries[entries.length - 1];
        if (last)
          this.noteLcp(last.renderTime || last.loadTime || last.startTime);
      },
    );

    // CLS: sum of layout-shift values without recent input, per path. One
    // running total across a visit would attribute one page's jumpiness to
    // every other page the visitor went on to read.
    const cls = new Map<string, number>();
    this.safeObserve<LayoutShiftEntry>("layout-shift", (entries) => {
      for (const e of entries) {
        if (e.hadRecentInput) continue;
        const path = this.currentPath();
        cls.set(path, (cls.get(path) ?? 0) + (e.value || 0));
      }
    });

    // INP: max event "interactionId" duration (approx - max event duration),
    // per path. An interaction belongs to the page it was made on.
    const inp = new Map<string, number>();
    this.safeObserve<PerformanceEventTiming>("event", (entries) => {
      for (const e of entries) {
        const dur = e.duration || 0;
        if (!e.interactionId) continue;
        const path = this.currentPath();
        if (dur > (inp.get(path) ?? 0)) inp.set(path, dur);
      }
    });

    // TTFB: navigation entry responseStart. Delivered twice — once from the
    // buffer, once on dispatch — so `report` deduplicates it.
    this.safeObserve<PerformanceNavigationTiming>("navigation", (entries) => {
      const nav = entries[0];
      if (nav?.responseStart) this.report("ttfb", nav.responseStart);
    });

    // Finalize accumulating metrics on hidden, each under the path it was
    // measured on rather than the one on screen at this moment.
    const finalize = () => {
      if (document.visibilityState !== "hidden") return;
      if (this.lcp) this.report("lcp", this.lcp, this.lcpPath);
      // Zero shift is a result, so a path with no entries at all still reports
      // one - but only the current one: a page nothing shifted on and nobody
      // is looking at any more has nothing to say.
      if (!cls.has(this.currentPath())) cls.set(this.currentPath(), 0);
      for (const [path, value] of cls) this.report("cls", value, path);
      for (const [path, value] of inp) {
        if (value) this.report("inp", value, path);
      }
    };
    document.addEventListener("visibilitychange", finalize);
  }

  protected safeObserve<T extends PerformanceEntry>(
    type: string,
    cb: (entries: T[]) => void,
  ) {
    try {
      const po = new PerformanceObserver((list) =>
        cb(list.getEntries() as T[]),
      );
      // buffered:true catches entries dispatched before observe() ran.
      // The Event Timing API only delivers interactions slower than
      // `durationThreshold`, 104 ms by default: every fast interaction
      // used to be invisible, so a responsive page reported no INP at all
      // and the p75 was taken over slow interactions only. 16 is the
      // minimum the API accepts.
      po.observe({
        type,
        buffered: true,
        ...(type === "event" ? { durationThreshold: 16 } : {}),
      } satisfies ObserverInit);
    } catch {
      /* entry type unsupported in this browser — skip */
    }
  }
}
