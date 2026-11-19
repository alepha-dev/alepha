import { projectFixture } from "@lore/core/testing";
import {
  CORE_NAV,
  NAV_BANDS,
  ProjectShellRegistry,
  type ProjectShellContext,
} from "@lore/core/web";
import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { ChatShell } from "../src/web/app/shell/ChatShell.ts";

/**
 * Chat's one sidebar row (#E161, #Q3924): between Activity and Quests as in
 * the mockup, and absent while the project has chat off or the rank cannot
 * read it.
 */
const boot = () => {
  const alepha = Alepha.create();
  alepha.inject(ChatShell);
  return alepha.inject(ProjectShellRegistry);
};

const context: ProjectShellContext = {
  routeName: "projectChat",
  params: {},
  get: () => undefined,
};

const offered = (
  shell: ProjectShellRegistry,
  capabilities: string[],
  permissions: string[],
): string[] =>
  shell
    .offeredNav(
      {
        ...projectFixture({ capabilities: capabilities as never }),
        permissions,
      } as never,
      context,
    )
    .map((entry) => entry.route);

describe("the Chat sidebar row", () => {
  it("is offered with chat on and chat:read held, and only then", ({
    expect,
  }) => {
    const shell = boot();

    expect(offered(shell, ["chat"], ["chat:read"])).toContain("projectChat");
    expect(offered(shell, ["plan"], ["chat:read"])).not.toContain(
      "projectChat",
    );
    expect(offered(shell, ["chat"], [])).not.toContain("projectChat");
  });

  it("sits after Activity, in the band above Quests", ({ expect }) => {
    const [row] = boot().navOf("chat");
    const activity = CORE_NAV.find((it) => it.route === "projectActivity")!;

    expect(row!.group).toBe("activity");
    expect(row!.order).toBeGreaterThan(activity.order);
    // Quests open the next band, so Chat is the last row before them.
    expect(NAV_BANDS.indexOf("work")).toBe(NAV_BANDS.indexOf("activity") + 1);
    expect(row!.permission).toBe("chat:read");
  });
});
