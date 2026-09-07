import { describe, it } from "vitest";

import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";

import {
  APP_TABS,
  type AppTab,
  type AppTabOption,
  type AppTabRoute,
  appTabsFor,
  appTabsFrom,
  type GatedAppTab,
} from "./appTabs.ts";

const anInstance = (
  kinds?: string[],
  over: Partial<AppInstanceResource> = {},
): AppInstanceResource =>
  ({
    id: "00000000-0000-4000-8000-000000000010",
    projectId: 1,
    app: "club",
    env: "production",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...(kinds
      ? {
          sigilId: "00000000-0000-4000-8000-000000000001",
          sigil: {
            id: "00000000-0000-4000-8000-000000000001",
            tokenPrefix: "sg_test_",
            kinds,
            createdAt: "2026-08-01T10:00:00.000Z",
          },
        }
      : {}),
    ...over,
  }) as AppInstanceResource;

const routes = (instance: AppInstanceResource) =>
  appTabsFor(instance).map((tab) => tab.route);

describe("the instance's tab set", () => {
  it("gives an instance with nothing three tabs", ({ expect }) => {
    // The normal state right after creation. Artifacts is unconditional
    // because builds come from CI rather than from telemetry.
    expect(routes(anInstance())).toEqual([
      "app",
      "appArtifacts",
      "appSettings",
    ]);
  });

  it("unlocks four more with a sigil that collects everything", ({
    expect,
  }) => {
    expect(routes(anInstance(["beacon", "blights"]))).toEqual([
      "app",
      "appAnalytics",
      "appVitals",
      "appErrors",
      "appExplore",
      "appArtifacts",
      "appSettings",
    ]);
  });

  it("keeps the per-kind gates inside the sigil's four", ({ expect }) => {
    // `beacon` fills the view and vitals datasets; `blights` fills the error
    // groups. An instance can carry either without the other, and copying one
    // gate from the other tab would get both backwards.
    expect(routes(anInstance(["beacon"]))).not.toContain("appErrors");
    expect(routes(anInstance(["blights"]))).toContain("appErrors");
    expect(routes(anInstance(["blights"]))).not.toContain("appAnalytics");
  });

  it("unlocks nothing for a sigil with every kind switched off", ({
    expect,
  }) => {
    // The honest answer: the credential exists and is allowed to collect
    // nothing, so there is nothing behind any of the four.
    expect(routes(anInstance([]))).toEqual([
      "app",
      "appArtifacts",
      "appSettings",
    ]);
  });

  it("adds nothing for an estate", ({ expect }) => {
    // Deploy and Environment are epic #1's and #1813's. No placeholder tab
    // ships: Environment is a security surface, and a tab standing there
    // invites somebody to fill it in without the crypto.
    expect(
      routes(anInstance(undefined, { estateId: crypto.randomUUID() })),
    ).toEqual(["app", "appArtifacts", "appSettings"]);
  });

  it("keeps Settings last in every combination", ({ expect }) => {
    // What makes the bar stable as an instance gains capabilities: tabs appear
    // and disappear BETWEEN Overview and Settings rather than at the edge.
    for (const kinds of [
      undefined,
      [],
      ["beacon"],
      ["blights"],
      ["beacon", "blights"],
    ]) {
      const set = routes(anInstance(kinds));
      expect(set.at(0)).toBe("app");
      expect(set.at(-1)).toBe("appSettings");
    }
  });

  it("takes the telemetry four away when the project's track option is off", ({
    expect,
  }) => {
    const instance = anInstance(["beacon", "blights"]);
    expect(
      appTabsFor(instance, { track: false }).map((tab) => tab.route),
    ).toEqual(["app", "appArtifacts", "appSettings"]);
    // And gives them all back untouched when it returns: the project switch
    // narrows, it never rewrites what each instance unlocked.
    expect(
      appTabsFor(instance, { track: true }).map((tab) => tab.route),
    ).toEqual(appTabsFor(instance).map((tab) => tab.route));
  });

  it("reads a missing key as off rather than as absent", ({ expect }) => {
    // Narrow, never widen - the rule `projectCapabilities` states for the
    // server's own reads. An empty bag is a project with nothing switched on,
    // not a caller declining to filter.
    expect(
      appTabsFor(anInstance(["beacon", "blights"]), {}).map((tab) => tab.route),
    ).toEqual(["app", "appArtifacts", "appSettings"]);
  });

  it("gives every gated tab an option and every baseline tab none", ({
    expect,
  }) => {
    // Overview, Artifacts and Settings are the Apps baseline per
    // `appsCapabilityOptionsSchema`, so they answer to no switch at all.
    const baseline = new Set(["app", "appArtifacts", "appSettings"]);
    for (const tab of APP_TABS) {
      if (baseline.has(tab.route)) {
        expect(tab.unlockedBy).toBeUndefined();
        expect(tab.option).toBeUndefined();
      } else {
        expect(tab.unlockedBy).toBeTypeOf("function");
        expect(tab.option).toBe("track");
      }
    }
  });

  it("carries no count on Errors and no Changelog slot", ({ expect }) => {
    expect(APP_TABS.map((tab) => tab.route)).not.toContain("appChangelog");
    // A `count` would need a query per page load to fill, and a confident `0`
    // where it had not resolved.
    expect(APP_TABS.every((tab) => !("count" in tab))).toBe(true);
  });
});

describe("the two axes of a tab's gate", () => {
  /**
   * A tab set with one tab per option, which `APP_TABS` cannot be until epic
   * #1's Deploy tab and #1813's Environment tab exist. `appArtifacts` stands in
   * for the Deploy route purely because `AppTabRoute` has no name for it yet -
   * nothing here depends on which route it is, only on which option it names.
   */
  const gatedOn = (option: AppTabOption, route: AppTabRoute): GatedAppTab => ({
    route,
    labelKey: "app.tab.overview",
    unlockedBy: () => true,
    option,
  });

  const twoAxes: AppTab[] = [
    { route: "app", labelKey: "app.tab.overview" },
    gatedOn("track", "appAnalytics"),
    gatedOn("deploy", "appArtifacts"),
    { route: "appSettings", labelKey: "app.tab.settings" },
  ];

  const routesOf = (options: Partial<Record<AppTabOption, boolean>>) =>
    appTabsFrom(twoAxes, anInstance(), options).map((tab) => tab.route);

  it("keeps the deploy tab for a project that tracks nothing", ({ expect }) => {
    // The project this epic is for: deploys through Lore, wants no analytics
    // sigil. Before the option was per tab it lost the Deploy tab with nothing
    // on screen saying why, and the switch that would bring it back was
    // labelled for telemetry.
    expect(routesOf({ track: false, deploy: true })).toEqual([
      "app",
      "appArtifacts",
      "appSettings",
    ]);
  });

  it("keeps the telemetry tab for a project that deploys elsewhere", ({
    expect,
  }) => {
    expect(routesOf({ track: true, deploy: false })).toEqual([
      "app",
      "appAnalytics",
      "appSettings",
    ]);
  });

  it("leaves the baseline standing with every option off", ({ expect }) => {
    expect(routesOf({ track: false, deploy: false })).toEqual([
      "app",
      "appSettings",
    ]);
  });

  it("keeps Settings last whichever options are on", ({ expect }) => {
    for (const options of [
      { track: false, deploy: false },
      { track: true, deploy: false },
      { track: false, deploy: true },
      { track: true, deploy: true },
    ]) {
      expect(routesOf(options).at(-1)).toBe("appSettings");
    }
  });
});
