import { projectFixture } from "@lore/core/testing";
import { ProjectShellRegistry, currentProjectAtom } from "@lore/core/web";
import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { appsCapabilityOptionsSchema } from "../src/api/schemas/appsCapabilityOptionsSchema.ts";
import { currentBlightCountAtom } from "../src/web/app/atoms/currentBlightCountAtom.ts";
import { DeployShell } from "../src/web/app/shell/DeployShell.ts";

describe("Uptime in the project sidebar", () => {
  it("keeps outage blights reachable without a tracking sigil", ({
    expect,
  }) => {
    const alepha = Alepha.create();
    alepha.inject(DeployShell);
    const shell = alepha.inject(ProjectShellRegistry);
    const project = projectFixture({
      capabilities: ["apps"],
      options: { apps: { uptime: true, track: false } },
    });
    alepha.store.set(currentProjectAtom, project);
    const context = {
      routeName: "projectUptime",
      params: {},
      get: alepha.store.get.bind(alepha.store),
    };
    expect(
      shell.offeredNav(project, context).map((row) => row.route),
    ).not.toContain("projectBlights");
    alepha.store.set(currentBlightCountAtom, { count: 1 });
    expect(
      shell.offeredNav(project, context).map((row) => row.route),
    ).toContain("projectBlights");
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
            capabilities: ["apps"],
            options: { apps: { uptime, track: false } },
          }),
          context,
        )
        .map((entry) => entry.route);
    expect(appsCapabilityOptionsSchema.parse({}).uptime).toBe(false);
    expect(offered(false)).not.toContain("projectUptime");
    expect(offered(true)).toContain("projectUptime");
    expect(shell.navOptions("apps")).toContain("uptime");
  });
});
