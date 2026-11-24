import { projectFixture } from "@lore/core/testing";
import { ProjectShellRegistry, visibleSettingsTabs } from "@lore/core/web";
import { Alepha } from "alepha";
import { AlephaReactRouter } from "alepha/react/router";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * Settings > Plan's Requirements tab (#Q4259): "Block a release on a failing
 * Must" left the Quests tab for a tab listed only while the Requirements
 * option is on.
 */
describe("Settings > Plan > Requirements", () => {
  let alepha: Alepha;
  let shell: ProjectShellRegistry;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    });
    alepha.with(AlephaReactRouter);
    bootLore(alepha, ["web"]);
    bootLore(alepha, ["routes"]);
    shell = alepha.inject(ProjectShellRegistry);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const planTabs = (requirements: boolean) => {
    const plan = shell.settingsSections().find((it) => it.key === "plan")!;
    return visibleSettingsTabs(
      plan,
      projectFixture({ options: { plan: { requirements } } }),
    ).map((tab) => tab.route);
  };

  it("lists the tab while Requirements is on, and hides it while off", ({
    expect,
  }) => {
    expect(planTabs(true)).toContain("projectSettingsRequirements");
    expect(planTabs(false)).not.toContain("projectSettingsRequirements");
    expect(planTabs(false)).toContain("projectSettingsWork");
  });

  it("labels the first tab Quests", ({ expect }) => {
    expect(shell.findSettingsTab("projectSettingsWork")?.tab.labelKey).toBe(
      "project.settings.tab.quests",
    );
  });
});
