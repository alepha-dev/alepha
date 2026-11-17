import { AutomationController, AutomationPersistence } from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * A preset opens in the canvas as an unsaved draft, or joins one (#Q3812):
 * its graph is built and checked like a create, and stored nowhere.
 */
describe("Preset drafts", () => {
  let alepha: Alepha;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;

  const draft = (body: Record<string, unknown>) =>
    alepha
      .inject(AutomationController)
      .draftAutomationFromPreset.fetch(
        { params: { projectId: project.id }, body: body as never },
        { user },
      )
      .then((response) => response.data);

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    });
    bootLore(alepha);
    const entities = alepha.inject(TestEntityRepositories);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "plan", options: { feedback: true } }],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("builds a preset's graph, laid out, and writes nothing", async ({
    expect,
  }) => {
    const persistence = alepha.inject(AutomationPersistence);
    const result = await draft({
      key: "feedback-created",
      values: { recipient: user.id },
    });
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.rule.nodes.map((node) => node.id)).toContain("source");
    expect(result.rule.nodes.every((node) => node.position)).toBe(true);
    expect(await persistence.rules.count({ projectId: project.id })).toBe(0);
  });

  it("prefixes the nodes of a preset joining a draft", async ({ expect }) => {
    const result = await draft({
      key: "feedback-created",
      values: { recipient: user.id },
      prefix: "feedback-created-2",
    });
    expect(
      result.rule.nodes.every((node) =>
        node.id.startsWith("feedback-created-2."),
      ),
    ).toBe(true);
    expect(
      result.rule.edges.every((edge) =>
        edge.from.startsWith("feedback-created-2."),
      ),
    ).toBe(true);
  });

  it("refuses values the preset does not take, as a 400", async ({
    expect,
  }) => {
    await expect(
      draft({ key: "feedback-created", values: { nope: "x" } }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
