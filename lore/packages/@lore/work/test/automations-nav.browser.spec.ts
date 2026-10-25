import { projectFixture } from "@lore/core/testing";
import { NAV_BANDS, ProjectShellRegistry } from "@lore/core/web";
import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { WorkShell } from "../src/web/app/shell/WorkShell.ts";

describe("Automations in the project sidebar", () => {
  it("sits in the last band, directly above Settings", ({ expect }) => {
    // #Q2678: Automations configures the project rather than being a daily
    // work surface, so it moved from between Epics and Feedback to the bottom
    // of the project nav.
    const alepha = Alepha.create();
    alepha.inject(WorkShell);
    const shell = alepha.inject(ProjectShellRegistry);
    const project = projectFixture({
      capabilities: ["work"],
      options: { work: { automations: true } },
    });
    const offered = shell.offeredNav(project, {
      routeName: "projectAutomations",
      params: {},
      get: () => undefined,
    });

    const automations = offered.find(
      (entry) => entry.route === "projectAutomations",
    );
    expect(automations?.group).toBe("config");
    expect(NAV_BANDS.at(-1)).toBe("config");
    expect(
      offered
        .filter((entry) => entry.group === "work")
        .map((entry) => entry.route),
    ).not.toContain("projectAutomations");
  });
});
