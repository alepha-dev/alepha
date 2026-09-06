import { describe, expect, it } from "vitest";

import { projectFixture } from "@/testing/projectFixture.ts";

import { reportsTabs } from "./reportsTabs.ts";

/**
 * Which Reports tabs a project has.
 *
 * Reports itself is Core: its ENTRY is unconditional, and each tab declares
 * what it needs. That split is the point, and it is what the first reading of
 * this epic got wrong - giving Reports to Work would have taken an Apps-only
 * project's Quality tab away with it.
 *
 * ⚠️ Quality no longer has a switch. It was gated on `features.quality`, an
 * optional key absent from every project that predated the module, and the
 * case that mattered was which way ABSENT read. The question now is whether a
 * run exists, which is the honest one: the tab appears once there is
 * something in it.
 */
describe("reportsTabs", () => {
  const names = (
    capabilities: Array<"work" | "knowledge" | "apps" | "support">,
    hasQualityRun = false,
  ) =>
    reportsTabs(projectFixture({ capabilities }), hasQualityRun).map(
      (tab) => tab.route,
    );

  it("gives a Work project the two derived quest tabs, plus Members", () => {
    expect(names(["work"])).toEqual([
      "reportsOverview",
      "reportsQuests",
      "reportsMembers",
    ]);
  });

  it("leaves Members standing on a project with no capability at all", () => {
    // Members comes from a core table, so it is the one tab that survives
    // everything being turned off - which is what makes Reports worth keeping
    // as a Core entry.
    expect(names([])).toEqual(["reportsMembers"]);
  });

  it("keeps Quality for an Apps-only project, once a run exists", () => {
    // The case that decided Reports is Core rather than Work: this project
    // has no quests at all and still needs to reach what CI pushed.
    expect(names(["apps"], true)).toEqual(["reportsMembers", "reportsQuality"]);
  });

  it("hides Quality until a run exists", () => {
    // Most projects will never push one, and a permanently empty tab on
    // everyone's Reports page is worse than no tab.
    expect(names(["apps"], false)).not.toContain("reportsQuality");
  });

  it("hides Quality when Apps is off, run or no run", () => {
    expect(names(["work"], true)).not.toContain("reportsQuality");
  });

  it("puts Quality after the tabs every project has", () => {
    // The three derived tabs are the ones people navigate by; an ingested one
    // appearing between them would move the others.
    expect(names(["work", "apps"], true).at(-1)).toBe("reportsQuality");
  });
});
