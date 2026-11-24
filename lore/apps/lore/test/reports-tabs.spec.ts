import { projectFixture } from "@lore/core/testing";
import { QualityShell, ReportsTabRegistry } from "@lore/core/web";
import { WorkShell } from "@lore/plan/web";
import { DeployShell } from "@lore/ship/web";
import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

/**
 * The tabs as Plan, Ship and core's Quality register them (#E75, #Q2611,
 * #Q4217).
 */
const registry = (() => {
  const alepha = Alepha.create();
  alepha.inject(WorkShell);
  alepha.inject(QualityShell);
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
 * this epic got wrong - giving Reports to Work would have taken a Ship-only
 * project's Quality tab away with it.
 *
 * Quality was Ship's, then Build's (#E162), and is Reports' own `quality`
 * option since Build went (#Q4217): it shows the push command until CI sends
 * a run (#Q3070), and a project with the option off shows no Quality tab.
 */
describe("reportsTabs", () => {
  it("declares the filters of each tab, and honours none on an unknown tab", () => {
    expect(registry.honours("reportsFlow")).toContain("area");
    expect(registry.honours("reportsBacklog")).not.toContain("grain");
    expect(registry.honours("reportsQuality")).toContain("branch");
    expect(registry.honours("reportsDelivery")).not.toContain("branch");
    expect(registry.honours("nowhere")).toEqual([]);
  });

  const names = (
    capabilities: Array<"plan" | "remember" | "ship" | "reports">,
    quality = false,
  ) =>
    registry
      .tabs(
        projectFixture({
          capabilities,
          options: { reports: { quality } },
        }),
      )
      .map((tab) => tab.route);

  it("gives a Plan project its tabs, plus Team", () => {
    // The fixture turns every option on, `feedback` included.
    expect(names(["plan"])).toEqual([
      "reportsSummary",
      "reportsFlow",
      "reportsBacklog",
      "reportsPlanning",
      "reportsSupport",
      "reportsTeam",
    ]);
  });

  it("hides the Support tab while Plan's feedback option is off", () => {
    const tabs = registry
      .tabs(
        projectFixture({
          capabilities: ["plan"],
          options: { plan: { feedback: false } },
        }),
      )
      .map((tab) => tab.route);
    expect(tabs).toContain("reportsPlanning");
    expect(tabs).not.toContain("reportsSupport");
  });

  it("leaves Team standing on a project with no capability at all", () => {
    // Team reads core's activity dataset, so it is the one tab that survives
    // everything being turned off - which is what makes Reports worth keeping
    // as a Core entry.
    expect(names([])).toEqual(["reportsSummary", "reportsTeam"]);
  });

  it("keeps Delivery for a Ship-only project, and no Quality while its option is off", () => {
    // The case that decided Reports is Core rather than Work: this project
    // has no quests at all and still needs to reach its deploys. Quality is
    // an option: not even its empty state shows here.
    expect(names(["ship"])).toEqual([
      "reportsSummary",
      "reportsDelivery",
      "reportsTeam",
    ]);
  });

  it("gives a project with Quality on its Quality tab, with no pillar at all (#Q4217)", () => {
    // What CI pushed is reached with no quest and no app.
    expect(names(["reports"], true)).toEqual([
      "reportsSummary",
      "reportsQuality",
      "reportsTeam",
    ]);
  });

  it("hides the Quality tab while Reports' quality option is off", () => {
    expect(names(["reports"], false)).not.toContain("reportsQuality");
  });

  it("hides Delivery and Quality when Ship and Quality are off", () => {
    expect(names(["plan"])).not.toContain("reportsDelivery");
    expect(names(["plan"])).not.toContain("reportsQuality");
  });
});
