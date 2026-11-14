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
      routeName: "projectUptime",
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
  it("hides when off or absent and appears without a sigil when enabled", ({
    expect,
  }) => {
    const alepha = Alepha.create();
    alepha.inject(DeployShell);
    const shell = alepha.inject(ProjectShellRegistry);
    const context = {
      routeName: "projectUptime",
      params: {},
      get: () => undefined,
    };
    const offered = (uptime: boolean) =>
      shell
        .offeredNav(
          projectFixture({
            capabilities: ["ship"],
            options: { ship: { uptime, track: false } },
          }),
          context,
        )
        .map((entry) => entry.route);
    expect(shipCapabilityOptionsSchema.parse({}).uptime).toBe(false);
    expect(offered(false)).not.toContain("projectUptime");
    expect(offered(true)).toContain("projectUptime");
    expect(shell.navOptions("ship")).toContain("uptime");
  });
});
