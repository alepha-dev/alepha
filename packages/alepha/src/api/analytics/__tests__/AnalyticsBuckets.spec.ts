import { describe, expect, it } from "vitest";

import { AnalyticsBuckets } from "../planner/AnalyticsBuckets.ts";

describe("AnalyticsBuckets", () => {
  it("formats a UTC hour bucket", () => {
    const millis = Date.UTC(2026, 7, 9, 14, 37, 12);
    expect(AnalyticsBuckets.hour(millis)).toBe("2026-08-09T14");
  });

  it("derives the day from an hour bucket by substring", () => {
    expect(AnalyticsBuckets.day("2026-08-09T14")).toBe("2026-08-09");
  });

  it("leaves a day bucket unchanged", () => {
    expect(AnalyticsBuckets.day("2026-08-09")).toBe("2026-08-09");
  });

  it("parses day-window specs into milliseconds", () => {
    expect(AnalyticsBuckets.parseWindow("60d")).toBe(60 * 24 * 60 * 60 * 1000);
    expect(AnalyticsBuckets.parseWindow("1d")).toBe(24 * 60 * 60 * 1000);
  });

  it("rejects a malformed window spec", () => {
    expect(() => AnalyticsBuckets.parseWindow("60")).toThrow(
      /malformed retention window/,
    );
    expect(() => AnalyticsBuckets.parseWindow("60h")).toThrow(
      /malformed retention window/,
    );
  });

  it("shifts a day bucket backwards across a month boundary", () => {
    expect(AnalyticsBuckets.shiftDays("2026-08-02", -3)).toBe("2026-07-30");
  });
});
