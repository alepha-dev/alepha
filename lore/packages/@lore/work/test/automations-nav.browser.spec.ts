import { projectFixture } from "@lore/core/testing";
import { ProjectShellRegistry, visibleSettingsTabs } from "@lore/core/web";
import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { WorkShell } from "../src/web/app/shell/WorkShell.ts";

describe("Automations in the project settings", () => {
  const setup = (automations: boolean) => {
    const alepha = Alepha.create();
    alepha.inject(WorkShell);
    const shell = alepha.inject(ProjectShellRegistry);
    const project = projectFixture({
      capabilities: ["work"],
      options: { work: { automations } },
    });
    return { shell, project };
  };

  it("is a Settings section after Members, not a sidebar entry", ({
    expect,
  }) => {
    // Automations configures the project rather than being a daily work
    // surface (#Q2678), so it left the sidebar for Settings (#Q3567).
    const { shell, project } = setup(true);
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
    const section = shell
      .settingsSections()
      .find((it) => it.key === "automations");
    expect(
      visibleSettingsTabs(section!, project).map((tab) => tab.route),
    ).toEqual(["projectAutomations"]);
  });

  it("is not listed while the automations option is off", ({ expect }) => {
    const { shell, project } = setup(false);
    const section = shell
      .settingsSections()
      .find((it) => it.key === "automations");
    expect(visibleSettingsTabs(section!, project)).toEqual([]);
  });
});
