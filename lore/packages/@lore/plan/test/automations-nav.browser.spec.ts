import { projectFixture } from "@lore/core/testing";
import { ProjectShellRegistry, visibleSettingsTabs } from "@lore/core/web";
import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { WorkShell } from "../src/web/app/shell/WorkShell.ts";

describe("Automations in the project settings", () => {
  const setup = () => {
    const alepha = Alepha.create();
    alepha.inject(WorkShell);
    const shell = alepha.inject(ProjectShellRegistry);
    const project = projectFixture({
      capabilities: ["work"],
      options: { work: {} },
    });
    return { shell, project };
  };

  it("is a Settings section after Members, not a sidebar entry", ({
    expect,
  }) => {
    // Automations configures the project rather than being a daily work
    // surface (#Q2678), so it left the sidebar for Settings (#Q3567).
    const { shell, project } = setup();
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

  it("is listed whatever the Work options say: automations are a baseline of Work", ({
    expect,
  }) => {
    // #Q3594: no `automations` option gates the tab any more.
    const { shell, project } = setup();
    const section = shell
      .settingsSections()
      .find((it) => it.key === "automations");
    expect(section?.capability).toBe("work");
    expect(
      visibleSettingsTabs(section!, project).map((tab) => tab.route),
    ).toEqual(["projectAutomations"]);
  });
});
