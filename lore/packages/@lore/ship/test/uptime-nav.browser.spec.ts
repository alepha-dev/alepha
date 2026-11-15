import { projectFixture } from "@lore/core/testing";
import { ProjectShellRegistry, currentProjectAtom } from "@lore/core/web";
import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { shipCapabilityOptionsSchema } from "../src/api/schemas/shipCapabilityOptionsSchema.ts";
import { currentErrorCountAtom } from "../src/web/app/atoms/currentErrorCountAtom.ts";
import { DeployShell } from "../src/web/app/shell/DeployShell.ts";

describe("Uptime in the project sidebar", () => {
  it("keeps outage errors reachable without a tracking sigil", ({ expect }) => {
    const alepha = Alepha.create();
    alepha.inject(DeployShell);
    const shell = alepha.inject(ProjectShellRegistry);
    const project = projectFixture({
      capabilities: ["ship"],
      options: { ship: { uptime: true, track: false } },
    });
    alepha.store.set(currentProjectAtom, project);
    const context = {
      routeName: "projectMonitor",
      params: {},
      get: alepha.store.get.bind(alepha.store),
    };
    expect(
      shell.offeredNav(project, context).map((row) => row.route),
    ).not.toContain("projectErrors");
    alepha.store.set(currentErrorCountAtom, { count: 1 });
    expect(
      shell.offeredNav(project, context).map((row) => row.route),
    ).toContain("projectErrors");
  });
  it("has no sidebar entry of its own: a monitor lives on its app", ({
    expect,
  }) => {
    const alepha = Alepha.create();
    alepha.inject(DeployShell);
    const shell = alepha.inject(ProjectShellRegistry);
    const context = {
      routeName: "projectMonitor",
      params: {},
      get: () => undefined,
    };
    const offered = shell.offeredNav(
      projectFixture({
        capabilities: ["ship"],
        options: { ship: { uptime: true, track: false } },
      }),
      context,
    );
    expect(shipCapabilityOptionsSchema.parse({}).uptime).toBe(false);
    expect(offered.map((entry) => entry.route)).not.toContain("projectUptime");
    // A monitor's page lights Apps (#Q3657).
    const apps = offered.find((entry) => entry.route === "projectApps");
    expect(apps?.activeOn?.("projectMonitor")).toBe(true);
    // Its switch is on the Apps settings page, not in General.
    expect(shell.navOptions("ship")).not.toContain("uptime");
    expect(shell.settingsOptions("ship")).toContain("uptime");
  });
});
