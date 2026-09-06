import { describe, it } from "vitest";

import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";

import { APP_TABS, appTabsFor } from "./appTabs.ts";

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

  it("carries no count on Errors and no Changelog slot", ({ expect }) => {
    expect(APP_TABS.map((tab) => tab.route)).not.toContain("appChangelog");
    // A `count` would need a query per page load to fill, and a confident `0`
    // where it had not resolved.
    expect(APP_TABS.every((tab) => !("count" in tab))).toBe(true);
  });
});
