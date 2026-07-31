type Metric = "lcp" | "cls" | "inp" | "fcp" | "ttfb";
type Sink = (m: { metric: Metric; value: number }) => void;

/**
 * Collects Core Web Vitals via PerformanceObserver and reports finalized
 * values. CLS is unitless and is scaled ×1000 to an integer so it buckets
 * with the same integer machinery as the ms metrics. Browser-guarded.
 */
export class PulseVitals {
  constructor(protected readonly sink: Sink) {}

  public report(metric: Metric, raw: number) {
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
    let lcp = 0;
    this.safeObserve(["largest-contentful-paint"], (entries) => {
      const last = entries[entries.length - 1];
      if (last)
        lcp =
          (last as any).renderTime || (last as any).loadTime || last.startTime;
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

    // TTFB: navigation entry responseStart.
    this.safeObserve(["navigation"], (entries) => {
      const nav = entries[0] as any;
      if (nav?.responseStart) this.report("ttfb", nav.responseStart);
    });

    // Finalize accumulating metrics on hidden.
    const finalize = () => {
      if (document.visibilityState !== "hidden") return;
      if (lcp) this.report("lcp", lcp);
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
