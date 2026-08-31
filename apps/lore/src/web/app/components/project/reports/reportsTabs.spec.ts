import { describe, expect, it } from "vitest";

import { reportsTabs } from "./reportsTabs.ts";

/**
 * Most projects will never push a quality run, and a permanently empty tab on
 * everyone's Reports page is worse than no tab.
 *
 * The gate is the same one `AppLayout` applies with `needsBeacon`: a tab whose
 * data source is off does not exist. The difference worth pinning is which way
 * an ABSENT flag reads - `features.quality` is optional and deliberately not in
 * `defaultProjectFeatures`, so every project that predates this module has no
 * key at all rather than `false`.
 */
describe("reportsTabs", () => {
  const names = (features: Record<string, boolean | undefined>) =>
    reportsTabs(features).map((tab) => tab.route);

  it("always offers the three derived tabs", () => {
    expect(names({})).toEqual([
      "reportsOverview",
      "reportsQuests",
      "reportsMembers",
    ]);
  });

  it("adds Quality when the feature is on", () => {
    expect(names({ quality: true })).toContain("reportsQuality");
  });

  /**
   * The case every existing project is in: the key is missing, not false.
   */
  it("hides Quality when the flag is absent", () => {
    expect(names({})).not.toContain("reportsQuality");
  });

  it("hides Quality when the flag is off", () => {
    expect(names({ quality: false })).not.toContain("reportsQuality");
  });

  /**
   * Quality goes last: the three derived tabs are the ones every project has,
   * and an ingested one appearing between them would move the tabs people
   * already navigate by.
   */
  it("puts Quality after the tabs every project has", () => {
    expect(names({ quality: true }).at(-1)).toBe("reportsQuality");
  });
});
