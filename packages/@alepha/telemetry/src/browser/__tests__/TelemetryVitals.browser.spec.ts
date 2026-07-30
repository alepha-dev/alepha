import { describe, expect, it } from "vitest";
import { TelemetryVitals } from "../TelemetryVitals.ts";

describe("TelemetryVitals", () => {
  it("reports finalized metrics, ms rounded, CLS scaled to int", () => {
    const got: any[] = [];
    const v = new TelemetryVitals((m) => got.push(m));
    v.report("lcp", 2345.6);
    v.report("cls", 0.123);
    expect(got).toEqual([
      { metric: "lcp", value: 2346 },
      { metric: "cls", value: 123 },
    ]);
  });

  it("observe() is a no-op when PerformanceObserver is unavailable", () => {
    const v = new TelemetryVitals(() => {});
    const orig = (globalThis as any).PerformanceObserver;
    (globalThis as any).PerformanceObserver = undefined;
    expect(() => v.observe()).not.toThrow();
    (globalThis as any).PerformanceObserver = orig;
  });
});
