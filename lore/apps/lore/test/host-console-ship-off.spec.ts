import { HostConsoleRegistry, HostTypeUiRegistry } from "@lore/core/web";
import { DeployHostConsole } from "@lore/ship/web";
import { Alepha } from "alepha";
import { describe, it } from "vitest";

/**
 * The host console and the add dialog with Ship on and off (#E166, #Q4105):
 * core's tabs always, Ship's Processes tab and stacks section only while
 * the project has Ship, and every host type in every project.
 */
describe("the host console with Ship off", () => {
  const boot = () => {
    const alepha = Alepha.create();
    alepha.inject(DeployHostConsole);
    return alepha;
  };
  const withShip = { capabilities: [{ key: "ship" as const, options: {} }] };
  const withoutShip = { capabilities: [{ key: "plan" as const, options: {} }] };

  it("shows Overview, Commands and Settings only, and Processes with Ship on", ({
    expect,
  }) => {
    const consoles = boot().inject(HostConsoleRegistry);
    expect(consoles.tabs(withoutShip as never).map((tab) => tab.route)).toEqual(
      ["bayOverview", "bayCommands", "baySettings"],
    );
    expect(consoles.tabs(withShip as never).map((tab) => tab.route)).toEqual([
      "bayOverview",
      "bayApps",
      "bayCommands",
      "baySettings",
    ]);
    // An instance page keeps Processes lit.
    expect(consoles.activeTab(withShip as never, "bayApp")).toBe("bayApps");
    expect(consoles.sections(withoutShip as never)).toEqual([]);
    expect(consoles.sections(withShip as never).map((it) => it.key)).toEqual([
      "stacks",
    ]);
  });

  it("offers both bay and cloudflare, whatever the project", ({ expect }) => {
    const types = boot().inject(HostTypeUiRegistry);
    expect(types.all().map((entry) => entry.type)).toEqual([
      "bay",
      "cloudflare",
    ]);
    expect(types.get("cloudflare")?.CreateFields).toBeDefined();
    expect(types.get("cloudflare")?.DrawerSection).toBeDefined();
  });
});
