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
    expect(() => AnalyticsBuckets.parseWindow("60w")).toThrow(
      /malformed retention window/,
    );
  });

  it("parses minute, hour and day windows", () => {
    expect(AnalyticsBuckets.parseWindow("90m")).toBe(90 * 60_000);
    expect(AnalyticsBuckets.parseWindow("48h")).toBe(48 * 3_600_000);
    expect(AnalyticsBuckets.parseWindow("2d")).toBe(2 * 86_400_000);
  });

  it("truncates a key to a coarser resolution and leaves a coarser key alone", () => {
    expect(AnalyticsBuckets.truncate("2026-10-18T08:47", "15m")).toBe(
      "2026-10-18T08:45",
    );
    expect(AnalyticsBuckets.truncate("2026-10-18T08:47", "1h")).toBe(
      "2026-10-18T08",
    );
    expect(AnalyticsBuckets.truncate("2026-10-18T08", "1d")).toBe("2026-10-18");
    expect(AnalyticsBuckets.truncate("2026-10-18", "1h")).toBe("2026-10-18");
  });

  it("shifts a day bucket backwards across a month boundary", () => {
    expect(AnalyticsBuckets.shiftDays("2026-08-02", -3)).toBe("2026-07-30");
  });

  it("floors a sub-hour bucket to its resolution", ({ expect }) => {
    const at = Date.parse("2026-10-18T08:47:59.999Z");
    expect(AnalyticsBuckets.bucket(at, "1m")).toBe("2026-10-18T08:47");
    expect(AnalyticsBuckets.bucket(at, "5m")).toBe("2026-10-18T08:45");
    expect(AnalyticsBuckets.bucket(at, "15m")).toBe("2026-10-18T08:45");
    expect(AnalyticsBuckets.bucket(at, "1h")).toBe("2026-10-18T08");
  });

  it("keeps every coarser key a prefix of the finer one", ({ expect }) => {
    const key = AnalyticsBuckets.bucket(Date.parse("2026-10-18T08:05Z"), "5m");
    expect(
      key.startsWith(AnalyticsBuckets.hour(Date.parse("2026-10-18T08:05Z"))),
    ).toBe(true);
    expect(AnalyticsBuckets.day(key)).toBe("2026-10-18");
  });

  it("validates a bucket key against a resolution", ({ expect }) => {
    expect(AnalyticsBuckets.isBucket("2026-10-18T08", "1h")).toBe(true);
    expect(AnalyticsBuckets.isBucket("2026-10-18T08:05", "1h")).toBe(false);
    expect(AnalyticsBuckets.isBucket("2026-10-18T08:05", "5m")).toBe(true);
    expect(AnalyticsBuckets.isBucket("2026-10-18T08:07", "5m")).toBe(false);
    expect(AnalyticsBuckets.isBucket("2026-10-18T08:30", "15m")).toBe(true);
    expect(AnalyticsBuckets.isBucket("2026-10-18", "1m")).toBe(false);
  });
});
