import { describe, expect, it } from "vitest";

import { sigilNormalizeReportedConfig } from "../sigilReportedConfig.ts";

const valid = {
  trackers: { views: true, errors: true, vitals: false },
  feedback: true,
  feedbackButton: "bottom-right",
  feedbackButtonExcludedPaths: ["/request"],
  reportOutsideProduction: false,
};

describe("sigilNormalizeReportedConfig", () => {
  it("passes a well-shaped config through", () => {
    expect(sigilNormalizeReportedConfig(valid)).toEqual(valid);
  });

  /**
   * An older client sends nothing on every batch. That is not an error and
   * must not read downstream as "everything is off" - absent means "this app
   * has not told us".
   */
  it("answers undefined for an absent config", () => {
    expect(sigilNormalizeReportedConfig(undefined)).toBeUndefined();
    expect(sigilNormalizeReportedConfig(null)).toBeUndefined();
  });

  it("refuses anything that is not an object", () => {
    for (const value of ["{}", 3, true, [], [valid]]) {
      expect(sigilNormalizeReportedConfig(value)).toBeUndefined();
    }
  });

  /**
   * The sender may be newer than the sink. A tracker name this build has never
   * heard of is kept and rendered as an unfamiliar row, which is more useful
   * than one silently missing - and is what stops a fourth tracker needing a
   * schema change on both sides at once.
   */
  it("keeps a tracker name it has never heard of", () => {
    const result = sigilNormalizeReportedConfig({
      ...valid,
      trackers: { ...valid.trackers, sessions: true },
    });
    expect(result?.trackers.sessions).toBe(true);
  });

  it("refuses a non-boolean tracker value", () => {
    expect(
      sigilNormalizeReportedConfig({
        ...valid,
        trackers: { views: "yes" },
      }),
    ).toBeUndefined();
  });

  /**
   * Refused rather than truncated, the same rule the rest of this wire
   * follows: a truncated exclusion list is a different configuration, not a
   * shorter one, and a page rendering it would be describing an app that does
   * not exist.
   */
  it("refuses an over-long value rather than truncating it", () => {
    expect(
      sigilNormalizeReportedConfig({
        ...valid,
        feedbackButtonExcludedPaths: ["x".repeat(257)],
      }),
    ).toBeUndefined();
    expect(
      sigilNormalizeReportedConfig({
        ...valid,
        feedbackButtonExcludedPaths: Array.from({ length: 51 }, () => "/x"),
      }),
    ).toBeUndefined();
    expect(
      sigilNormalizeReportedConfig({
        ...valid,
        feedbackButton: "x".repeat(33),
      }),
    ).toBeUndefined();
    expect(
      sigilNormalizeReportedConfig({
        ...valid,
        trackers: { ["x".repeat(33)]: true },
      }),
    ).toBeUndefined();
  });

  it("refuses a missing required field rather than defaulting it", () => {
    for (const key of [
      "trackers",
      "feedback",
      "feedbackButton",
      "feedbackButtonExcludedPaths",
      "reportOutsideProduction",
    ]) {
      const { [key]: _dropped, ...rest } = valid as Record<string, unknown>;
      expect(sigilNormalizeReportedConfig(rest)).toBeUndefined();
    }
  });

  /**
   * A sink and an app deploy independently, so a position the sink has never
   * heard of must not cost the whole batch. Free text, bounded.
   */
  it("accepts a feedback button position it does not recognise", () => {
    const result = sigilNormalizeReportedConfig({
      ...valid,
      feedbackButton: "middle-left",
    });
    expect(result?.feedbackButton).toBe("middle-left");
  });
});
