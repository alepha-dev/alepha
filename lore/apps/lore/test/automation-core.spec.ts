import { AutomationController } from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { appInstances } from "@lore/ship/schemas";
import { Alepha } from "alepha";
import { JobQueueProvider } from "alepha/api/jobs";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class CoreQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class CoreRows {
  public readonly instances = $repository(appInstances);
}

/**
 * Automations are a Core feature since #Q3629, owned by no capability, like
 * the dashboard: a project with Ship alone still creates, lists, pauses and
 * resumes a deploy rule, and only the presets its capabilities allow are
 * offered.
 */
describe("Automations are Core (#Q3629)", () => {
  let alepha: Alepha;
  let api: AutomationController;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  let entities: TestEntityRepositories;
  let rows: CoreRows;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: CoreQueue });
    bootLore(alepha);
    api = alepha.inject(AutomationController);
    entities = alepha.inject(TestEntityRepositories);
    rows = alepha.inject(CoreRows);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "ship", options: { deploy: true, uptime: true } }],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
    await rows.instances.create({
      projectId: project.id,
      app: "site",
      env: "production",
    });
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("creates, lists, pauses and resumes a deploy rule in a project with only Ship", async ({
    expect,
  }) => {
    const params = { projectId: project.id };
    const created = (
      await api.createAutomationFromPreset.fetch(
        {
          params,
          body: {
            key: "deploy-failed",
            values: { app: "site", recipient: user.id },
            enabled: true,
          },
        },
        { user },
      )
    ).data;
    expect(created).toMatchObject({ enabled: true });

    const listed = (
      await api.listAutomations.fetch({ params, query: {} }, { user })
    ).data.items;
    expect(listed.map((item) => item.id)).toEqual([created.id]);

    const paused = (
      await api.setAutomationEnabled.fetch(
        {
          params: { ...params, id: created.id },
          body: { enabled: false, expectedRevision: created.revision },
        },
        { user },
      )
    ).data;
    expect(paused).toMatchObject({ enabled: false });

    const resumed = (
      await api.setAutomationEnabled.fetch(
        {
          params: { ...params, id: created.id },
          body: { enabled: true, expectedRevision: paused.revision },
        },
        { user },
      )
    ).data;
    expect(resumed).toMatchObject({ enabled: true, health: "active" });
  });

  it("offers the deploy presets and hides the quest presets", async ({
    expect,
  }) => {
    const catalog = (
      await api.getAutomationCatalog.fetch(
        { params: { projectId: project.id } },
        { user },
      )
    ).data;
    const available = catalog.presets
      .filter((preset) => preset.available)
      .map((preset) => preset.key);
    expect(available).toContain("deploy-failed");
    expect(available).not.toContain("tagged-quest-digest");
    expect(available).not.toContain("epic-completed");
    expect(available).not.toContain("feedback-created");

    await expect(
      api.createAutomationFromPreset.fetch(
        {
          params: { projectId: project.id },
          body: {
            key: "tagged-quest-digest",
            values: { recipient: user.id, tag: "bug" },
          },
        },
        { user },
      ),
    ).rejects.toThrow("plan");
  });
});
