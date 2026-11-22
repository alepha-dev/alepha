import { ProjectShellRegistry } from "@lore/core/web";
import { Alepha } from "alepha";
import { AlephaReactRouter } from "alepha/react/router";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * Which settings tabs run the body's full width (#Q3658).
 *
 * 51e794e71 widened every settings page to let the Hosts table fill the
 * page. The choice is now each tab's `fullWidth`: this pins the tables
 * that ask for it, and a few pages of setting blocks that must not.
 */
describe("settings tabs fullWidth", () => {
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

  it("should run Hosts and Ranks full width", ({ expect }) => {
    expect(shell.findSettingsTab("projectSettingsHosts")?.tab.fullWidth).toBe(
      true,
    );
    expect(shell.findSettingsTab("projectSettingsRanks")?.tab.fullWidth).toBe(
      true,
    );
  });

  it("should keep pages of setting blocks in the centred column", ({
    expect,
  }) => {
    for (const route of [
      "projectSettingsBanner",
      "projectSettingsCapabilities",
      // #Q4053 widened it alongside Ranks; it keeps the column (#Q4118).
      "projectSettingsMembers",
      "projectSettingsQuality",
    ]) {
      const found = shell.findSettingsTab(route);
      expect(found, route).toBeDefined();
      expect(found?.tab.fullWidth, route).toBeUndefined();
    }
  });
});
