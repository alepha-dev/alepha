import { projectFixture } from "@lore/core/testing";
import { ProjectShellRegistry } from "@lore/core/web";
import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { appsCapabilityOptionsSchema } from "../src/api/schemas/appsCapabilityOptionsSchema.ts";
import { DeployShell } from "../src/web/app/shell/DeployShell.ts";

describe("Uptime in the project sidebar", () => {
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
