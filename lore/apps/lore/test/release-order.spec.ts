import { describe, expect, it } from "vitest";

import { compareReleaseTags } from "../src/api/releaseOrder.ts";

/**
 * The regression guard for quest #1640.
 *
 * Both release tables used to sort on the release's `number`, a `$sequence`
 * described as "the creation sequence, which for releases IS version order".
 * It is only that while releases are created in version order, and the Lore
 * project itself had already broken it by planning `1.0.0` before `0.29.0`.
 *
 * Every case here shuffles the input on purpose. A fixture created in version
 * order cannot tell the three candidate keys (text, `number`, parsed version)
 * apart, which is exactly why the e2e that shipped with #1633 passed against
 * the wrong comparator.
 */
describe("compareReleaseTags", () => {
  const sorted = (tags: string[]) => [...tags].sort(compareReleaseTags);

  it("orders versions numerically, not as text", () => {
    // As text `0.10.0` and `0.28.0` both precede `0.9.0`, because `1` and `2`
    // precede `9`. This is the ordering the whole file exists for.
    expect(sorted(["0.28.0", "1.0.0", "0.9.0", "0.29.0", "0.10.0"])).toEqual([
      "0.9.0",
      "0.10.0",
      "0.28.0",
      "0.29.0",
      "1.0.0",
    ]);
  });

  it("orders the reporter's own shuffled set", () => {
    // The four tags of the #1633 e2e fixture, fed in the order that made the
    // bug visible: `1.0.0` created before `0.29.0`.
    expect(sorted(["0.28.0", "1.0.0", "0.29.0", "0.9.0"])).toEqual([
      "0.9.0",
      "0.28.0",
      "0.29.0",
      "1.0.0",
    ]);
  });

  it("puts a shorter prefix first and treats a missing segment as zero", () => {
    expect(sorted(["1.0.1", "1.0"])).toEqual(["1.0", "1.0.1"]);
    expect(compareReleaseTags("1.0", "1.0.0")).toBe(0);
  });

  it("puts a prerelease before its own release", () => {
    expect(sorted(["1.0.0", "1.0.0-rc.1"])).toEqual(["1.0.0-rc.1", "1.0.0"]);
  });

  it("orders prereleases with a numeric-aware collation", () => {
    expect(sorted(["1.0.0-rc.10", "1.0.0-rc.2"])).toEqual([
      "1.0.0-rc.2",
      "1.0.0-rc.10",
    ]);
  });

  it("accepts a leading v", () => {
    expect(sorted(["v1.0.0", "v0.9.0"])).toEqual(["v0.9.0", "v1.0.0"]);
  });

  it("sorts a non-version tag after every version, not among the 1.x", () => {
    // `demo-1` is what the New Release hint offers as the counter-example, so
    // it has to have a defined place. Pulling its digits out would sort it as
    // version 1 and drop it in the middle of the real releases.
    expect(sorted(["demo-1", "1.0.0", "0.9.0"])).toEqual([
      "0.9.0",
      "1.0.0",
      "demo-1",
    ]);
  });

  it("orders non-version tags against each other numerically too", () => {
    expect(sorted(["demo-10", "demo-2"])).toEqual(["demo-2", "demo-10"]);
  });

  it("reports equal for two tags it cannot separate, leaving the tiebreak", () => {
    // The caller falls back to `number` on 0, which is what keeps rows stable.
    expect(compareReleaseTags("demo", "demo")).toBe(0);
    expect(compareReleaseTags("2.0.0", "2.0.0")).toBe(0);
  });
});
