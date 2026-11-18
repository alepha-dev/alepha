import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { projectFixture } from "../../../testing/projectFixture.ts";
import { visibleSettingsTabs } from "../components/project/settings/projectSettingsSections.ts";
import { ProjectShellRegistry } from "./ProjectShellRegistry.ts";

describe("Automations in the project settings", () => {
  const setup = (capabilities: ("plan" | "remember" | "ship")[]) => {
    const alepha = Alepha.create();
    const shell = alepha.inject(ProjectShellRegistry);
    const project = projectFixture({ capabilities });
    return { shell, project };
  };

  it("is a Settings section after Members, not a sidebar entry", ({
    expect,
  }) => {
    // Automations configures the project rather than being a daily work
    // surface (#Q2678), so it left the sidebar for Settings (#Q3567).
    const { shell, project } = setup(["plan"]);
    const offered = shell.offeredNav(project, {
      routeName: "projectAutomations",
      params: {},
      get: () => undefined,
    });
    expect(offered.map((entry) => entry.route)).not.toContain(
      "projectAutomations",
    );

    const keys = shell.settingsSections().map((section) => section.key);
    expect(keys.indexOf("automations")).toBe(keys.indexOf("members") + 1);
  });

  it("is listed in every project, whatever its capabilities: automations are Core", ({
    expect,
  }) => {
    // #Q3629: the section is core's and belongs to no capability.
    for (const capabilities of [[], ["ship"], ["plan"]] as const) {
      const { shell, project } = setup([...capabilities]);
      const section = shell
        .settingsSections()
        .find((it) => it.key === "automations");
      expect(section?.capability).toBeUndefined();
      expect(
        visibleSettingsTabs(section!, project).map((tab) => tab.route),
      ).toEqual(["projectAutomations"]);
    }
  });
});
