import { describe, expect, it } from "vitest";
import { SigilVitals } from "../SigilVitals.ts";

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
});
