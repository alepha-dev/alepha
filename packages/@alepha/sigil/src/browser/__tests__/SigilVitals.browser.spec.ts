import { describe, expect, it } from "vitest";
import { SigilVitals } from "../SigilVitals.ts";

/**
 * Reaches the LCP entry handler without a `PerformanceObserver`, which jsdom
 * does not dispatch largest-contentful-paint entries through.
 */
class TestSigilVitals extends SigilVitals {
  public testNoteLcp(value: number) {
    this.noteLcp(value);
  }
}

describe("SigilVitals", () => {
  it("reports finalized metrics, ms rounded, CLS scaled to int", () => {
    const got: any[] = [];
    const v = new SigilVitals((m) => got.push(m));
    v.report("lcp", 2345.6);
    v.report("cls", 0.123);
    expect(got).toEqual([
      { metric: "lcp", value: 2346 },
      { metric: "cls", value: 123 },
    ]);
  });

  /**
   * `ttfb` shipped twice on every page view in production — the navigation
   * entry reaches a `buffered: true` observer once from the buffer and again on
   * dispatch. A duplicate does not move the p75, it inflates the population the
   * p75 is computed over, so one visitor counts as two.
   */
  it("emits each metric once, dropping the duplicate report", () => {
    const got: any[] = [];
    const v = new SigilVitals((m) => got.push(m));

    v.report("ttfb", 76);
    v.report("ttfb", 76);

    expect(got).toEqual([{ metric: "ttfb", value: 76 }]);
  });

  /**
   * `finalize` runs on every `visibilitychange` to hidden, so a visitor who
   * tabs away and comes back reported the accumulating metrics again — with a
   * *different* value the second time, which is the case most likely to look
   * like real data.
   */
  it("keeps the first value when a later report carries a different one", () => {
    const got: any[] = [];
    const v = new SigilVitals((m) => got.push(m));

    v.report("cls", 0.05);
    v.report("cls", 0.42);

    expect(got).toEqual([{ metric: "cls", value: 50 }]);
  });

  it("observe() is a no-op when PerformanceObserver is unavailable", () => {
    const v = new SigilVitals(() => {});
    const orig = (globalThis as any).PerformanceObserver;
    (globalThis as any).PerformanceObserver = undefined;
    expect(() => v.observe()).not.toThrow();
    (globalThis as any).PerformanceObserver = orig;
  });

  /**
   * `SigilBrowserProvider` waits on this to decide the page has settled enough
   * to talk to the server. It has to fire on the *first* entry: LCP is
   * dispatched again for every larger element, and a signal that re-fires would
   * keep re-triggering the thing waiting on it.
   */
  it("notifies onLcp once, on the first entry", () => {
    let notified = 0;
    const v = new TestSigilVitals(
      () => {},
      () => notified++,
    );

    v.testNoteLcp(1200);
    v.testNoteLcp(2400);

    expect(notified).toBe(1);
  });

  /**
   * The callback is a timing signal, not a measurement — the value is still
   * only final at hidden, and the last entry is the one that counts.
   */
  it("still reports the last LCP value, not the one that triggered onLcp", () => {
    const got: any[] = [];
    const v = new TestSigilVitals(
      (m) => got.push(m),
      () => {},
    );

    v.testNoteLcp(1200);
    v.testNoteLcp(2400);
    v.report("lcp", 2400);

    expect(got).toEqual([{ metric: "lcp", value: 2400 }]);
  });

  /**
   * An app that collects no vitals still needs the signal, because it is what
   * tells it when to go and ask for its config. Gating the callback behind the
   * metric sink would leave such an app waiting on the fallback timer forever.
   */
  it("notifies onLcp even when nothing consumes the metrics", () => {
    let notified = 0;
    const v = new TestSigilVitals(
      () => {
        throw new Error("sink must not be consulted for the timing signal");
      },
      () => notified++,
    );

    v.testNoteLcp(1500);

    expect(notified).toBe(1);
  });
});
