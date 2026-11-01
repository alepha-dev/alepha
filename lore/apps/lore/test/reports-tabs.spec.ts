import { projectFixture } from "@lore/core/testing";
import { ReportsTabRegistry } from "@lore/core/web";
import { DeployShell } from "@lore/deploy/web";
import { WorkShell } from "@lore/work/web";
import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

/**
 * The tabs as Work and Deploy register them (#E75, #Q2611).
 */
const registry = (() => {
  const alepha = Alepha.create();
  alepha.inject(WorkShell);
  alepha.inject(DeployShell);
  const tabs = alepha.inject(ReportsTabRegistry);
  // Core's own tab, which `CoreRouter` registers.
  tabs.register({
    route: "reportsSummary",
    labelKey: "project.reports.nav.summary",
    order: 5,
  });
  return tabs;
})();

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
  it("declares the filters of each tab, and honours none on an unknown tab", () => {
    expect(registry.honours("reportsFlow")).toContain("area");
    expect(registry.honours("reportsBacklog")).not.toContain("grain");
    expect(registry.honours("reportsDelivery")).toContain("branch");
    expect(registry.honours("nowhere")).toEqual([]);
  });

  const names = (
    capabilities: Array<"work" | "knowledge" | "apps" | "support">,
  ) => registry.tabs(projectFixture({ capabilities })).map((tab) => tab.route);

  it("gives a Work project its tabs, plus Team", () => {
    expect(names(["work"])).toEqual([
      "reportsSummary",
      "reportsFlow",
      "reportsBacklog",
      "reportsPlanning",
      "reportsTeam",
    ]);
  });

  it("leaves Team standing on a project with no capability at all", () => {
    // Team reads core's activity dataset, so it is the one tab that survives
    // everything being turned off - which is what makes Reports worth keeping
    // as a Core entry.
    expect(names([])).toEqual(["reportsSummary", "reportsTeam"]);
  });

  it("keeps Delivery for an Apps-only project", () => {
    // The case that decided Reports is Core rather than Work: this project
    // has no quests at all and still needs to reach what CI pushed, which is
    // a section of Delivery since #Q3010.
    expect(names(["apps"])).toEqual([
      "reportsSummary",
      "reportsDelivery",
      "reportsTeam",
    ]);
  });

  it("hides Delivery when Apps is off", () => {
    expect(names(["work"])).not.toContain("reportsDelivery");
  });
});
