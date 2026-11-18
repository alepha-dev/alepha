import { AutomationCatalog } from "@lore/core/api";
import {
  AutomationOutline,
  type AutomationGraphValue,
} from "@lore/core/schemas";
import { Alepha } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * "Before you save" reads each node's required fields in the browser
 * (#Q3849), a second reading of what `AutomationCatalog.compile` requires.
 * This holds the two together for every action type: a field compile
 * refuses when it is missing or empty is one the browser lists as To fill.
 */
describe("The outline's required fields against compile", () => {
  let alepha: Alepha;
  let user: UserAccountToken;
  let projectId: number;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "error" },
    });
    bootLore(alepha, ["api"]);
    const entities = alepha.inject(TestEntityRepositories);
    await alepha.start();
    const project = await createTestProject(alepha, {
      capabilities: [
        { key: "plan", options: { releases: true, epics: true } },
        { key: "remember" },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] } as UserAccountToken;
    projectId = project.id;
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("lists as To fill every field compile refuses empty, for every action type", async ({
    expect,
  }) => {
    const catalog = alepha.inject(AutomationCatalog);
    const outline = new AutomationOutline();
    const nodeTypes = catalog
      .nodeTypes()
      .map((item) => ({ ...item, available: true }));
    const valid: Record<string, Record<string, unknown>> = {
      notify: {
        recipient: user.id,
        channels: ["inbox"],
        title: "Done",
        text: "{{title}}",
        category: "automations",
      },
      appendFolio: { folio: crypto.randomUUID(), text: "{{title}}" },
      createQuest: { title: "{{title}}", description: "Look", area: "ops" },
      assignRelease: { quest: 1, release: 1 },
      addTag: { quest: 1, tag: "done" },
    };
    const actions = nodeTypes.filter((item) => item.kind === "action");
    expect(actions.map((item) => item.type).sort()).toEqual(
      Object.keys(valid).sort(),
    );
    const graph = (
      type: string,
      config: Record<string, unknown>,
    ): AutomationGraphValue => ({
      version: 2,
      nodes: [
        { id: "source", kind: "source", type: "quest.completed", config: {} },
        { id: "action-1", kind: "action", type, config },
      ],
      edges: [{ from: "source", port: "out", to: "action-1" }],
    });
    const refuses = async (value: AutomationGraphValue) => {
      try {
        await catalog.compile(projectId, user, value, undefined, undefined, {
          targets: false,
        });
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    let refusals = 0;
    for (const action of actions) {
      const config = valid[action.type];
      const whole = graph(action.type, config);
      expect({ type: action.type, refused: await refuses(whole) }).toEqual({
        type: action.type,
        refused: undefined,
      });
      expect(outline.unfilled(whole, nodeTypes)).toEqual([]);
      for (const key of Object.keys(config))
        for (const blank of [undefined, ""]) {
          const next = { ...config };
          if (blank === undefined) delete next[key];
          else next[key] = typeof config[key] === "number" ? 0 : blank;
          const value = graph(action.type, next);
          const refusal = await refuses(value);
          if (!refusal) continue;
          refusals++;
          expect({
            type: action.type,
            key,
            blank,
            refusal,
            listed: outline
              .unfilled(value, nodeTypes)
              .some((item) => item.slot === key),
          }).toMatchObject({ listed: true });
        }
    }
    expect(refusals).toBeGreaterThan(8);
  });
});
