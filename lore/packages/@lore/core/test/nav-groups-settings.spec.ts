import { describe, it } from "vitest";

import { navGroupsWithSettings } from "../src/web/app/components/project/capabilityNav.ts";

/**
 * Settings and the config band read as one group (#Q2936): Automations, the
 * last config entry, sits directly above Settings with no separator.
 */
describe("navGroupsWithSettings", () => {
  it("should put Settings in the config band's group", ({ expect }) => {
    const groups = navGroupsWithSettings(
      [["activity"], ["quests"], ["folios"], ["apps"], ["automations"]],
      "settings",
    );

    expect(groups.at(-1)).toEqual({ items: ["automations", "settings"] });
    expect(groups).toHaveLength(5);
  });

  it("should keep Settings apart from the band above when config is empty", ({
    expect,
  }) => {
    const groups = navGroupsWithSettings(
      [["activity"], ["quests"], ["folios"], ["apps"], []],
      "settings",
    );

    expect(groups.at(-2)).toEqual({ items: ["apps"] });
    expect(groups.at(-1)).toEqual({ items: ["settings"] });
  });

  it("should drop every other empty band", ({ expect }) => {
    const groups = navGroupsWithSettings(
      [["activity"], [], [], [], []],
      "settings",
    );

    expect(groups).toEqual([{ items: ["activity"] }, { items: ["settings"] }]);
  });
});
