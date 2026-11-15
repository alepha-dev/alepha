import {
  AutomationController,
  AutomationEvents,
  AutomationPersistence,
  AutomationWorker,
} from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { ReleaseController } from "@lore/plan/api";
import { Alepha, AlephaError } from "alepha";
import { JobQueueProvider, jobExecutionEntity } from "alepha/api/jobs";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class ReleaseQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class ReleaseRows {
  jobs = $repository(jobExecutionEntity);
}

/**
 * Release mail goes only through automations (#Q3625): ReleaseNotifier is
 * gone, so publishing with no rule notifies nobody, and the Releases page's
 * bell (the Release published preset) notifies its viewer.
 */
describe("Release notifications through the Releases bell (#Q3625)", () => {
  let alepha: Alepha;
  let entities: TestEntityRepositories;
  let persistence: AutomationPersistence;
  let rows: ReleaseRows;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let publisher: UserAccountToken;
  let viewer: UserAccountToken;

  const notifications = () =>
    rows.jobs.findMany({ where: { jobName: "system.notifications.send" } });
  const publish = async (tag: string) => {
    const controller = alepha.inject(ReleaseController);
    const release = (
      await controller.createRelease.fetch(
        {
          params: { projectId: project.id },
          body: { tag, title: `Release ${tag}` },
        },
        { user: publisher },
      )
    ).data;
    await controller.publishRelease.fetch(
      { params: { id: release.id }, body: {} },
      { user: publisher },
    );
  };
  const drain = async () => {
    await alepha.inject(AutomationEvents).sweep(50);
    const ready = await persistence.receipts.findMany({
      where: { kind: "occurrence", status: "ready" },
    });
    for (const receipt of ready) {
      let input: { receiptId: string; token?: string } | undefined = {
        receiptId: receipt.id,
      };
      for (let count = 0; input && count < 20; count++)
        input = await alepha.inject(AutomationWorker).step(input, 3);
      if (input) throw new AlephaError("Release worker exceeded its budget");
    }
  };

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: ReleaseQueue });
    bootLore(alepha);
    entities = alepha.inject(TestEntityRepositories);
    persistence = alepha.inject(AutomationPersistence);
    rows = alepha.inject(ReleaseRows);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "plan", options: { releases: true } }],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    publisher = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
    const member = await entities.users.create({
      roles: ["user"],
      email: `viewer-${project.id}@example.test`,
    });
    await createTestMember(alepha, project, member.id, { rank: "admin" });
    viewer = { id: member.id, roles: ["user"] };
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("publishing with no rule notifies nobody", async ({ expect }) => {
    await publish("1.0.0");
    await drain();
    expect(await notifications()).toHaveLength(0);
  });

  it("notifies the viewer who turned the bell on, once per release", async ({
    expect,
  }) => {
    const on = (
      await alepha.inject(AutomationController).setAutomationSubscription.fetch(
        {
          params: { projectId: project.id },
          body: { presets: ["release-published"], subscribed: true },
        },
        { user: viewer },
      )
    ).data;
    expect(on.subscribed).toBe(true);

    await publish("1.0.0");
    await drain();
    const sent = await notifications();
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0].payload)).toContain(viewer.id);
    expect(JSON.stringify(sent[0].payload)).toContain("1.0.0");

    // Replaying the sweep sends nothing more.
    await drain();
    expect(await notifications()).toHaveLength(1);
  });
});
