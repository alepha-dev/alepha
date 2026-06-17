import { describe, it } from "vitest";
import {
  ESTIMATE_PRESETS,
  formatEstimate,
} from "../src/web/app/components/campaign/quest/questEstimate.ts";

/**
 * Pure formatter for the optional quest time-estimate (`quests.estimateMinutes`).
 * Stored as raw minutes; rendered as a compact, glanceable string. A "day" is
 * one workday = 480 min, which is also the largest preset chip (`1d`).
 */
describe("formatEstimate", () => {
  it("renders sub-hour values in minutes", ({ expect }) => {
    expect(formatEstimate(5)).toBe("5m");
    expect(formatEstimate(15)).toBe("15m");
    expect(formatEstimate(25)).toBe("25m");
    expect(formatEstimate(30)).toBe("30m");
  });

  it("renders whole hours without a minutes suffix", ({ expect }) => {
    expect(formatEstimate(60)).toBe("1h");
    expect(formatEstimate(120)).toBe("2h");
    expect(formatEstimate(240)).toBe("4h");
  });

  it("renders hours+minutes as zero-padded `1h30`", ({ expect }) => {
    expect(formatEstimate(90)).toBe("1h30");
    expect(formatEstimate(200)).toBe("3h20");
    expect(formatEstimate(65)).toBe("1h05");
  });

  it("treats 480 min as one workday and renders `1d`", ({ expect }) => {
    expect(formatEstimate(480)).toBe("1d");
    expect(formatEstimate(960)).toBe("2d");
  });

  it("renders multi-day remainders compactly", ({ expect }) => {
    expect(formatEstimate(600)).toBe("1d2h"); // 480 + 120
    expect(formatEstimate(525)).toBe("1d45m"); // 480 + 45, no hours
    expect(formatEstimate(550)).toBe("1d1h10"); // 480 + 70
  });

  it("returns an empty string for zero or negative input", ({ expect }) => {
    expect(formatEstimate(0)).toBe("");
    expect(formatEstimate(-5)).toBe("");
  });

  it("exposes presets whose labels round-trip through formatEstimate", ({
    expect,
  }) => {
    expect(ESTIMATE_PRESETS).toEqual([5, 15, 30, 60, 120, 240, 480]);
    expect(ESTIMATE_PRESETS.map(formatEstimate)).toEqual([
      "5m",
      "15m",
      "30m",
      "1h",
      "2h",
      "4h",
      "1d",
    ]);
  });
});
