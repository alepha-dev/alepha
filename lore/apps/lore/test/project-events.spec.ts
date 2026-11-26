import {
  LoreDatabase,
  ProjectDeletionService,
  ProjectEventCatalog,
  ProjectEvents,
  ProjectMergeService,
  projectEvents,
} from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import {
  FeedbackController,
  QuestController,
  ReleaseController,
} from "@lore/plan/api";
import { DeployRegistry, UptimeStateService } from "@lore/ship/api";
import { appInstances, deployments, monitors } from "@lore/ship/schemas";
import { Alepha } from "alepha";
import { JobQueueProvider } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import {
  $repository,
  DatabaseProvider,
  NodeSqliteProvider,
  sql,
  type SQLLike,
} from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestEpic,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

const onPostgres = process.env.DATABASE_TEST_DIALECT === "postgres";

class EventRows extends TestEntityRepositories {
  events = $repository(projectEvents);
  instances = $repository(appInstances);
  deployments = $repository(deployments);
  monitors = $repository(monitors);
}
class SilentQueue extends JobQueueProvider {
  public override async dispatch() {}
}
/**
 * Fails every batch it is told to, after the statements it was given: the
 * change, its events and all.
 */
class FailingDatabase extends LoreDatabase {
  public fail = false;
  public override batch(statements: SQLLike[]) {
    if (!this.fail) return super.batch(statements);
    return super.batch([
      ...statements,
      sql`INSERT INTO missing_project_events_test_table (id) VALUES (1)`,
    ]);
  }
}

/**
 * Project events (#Q3889): one table, written with the change that caused it
 * by every source the automations had, plus three quest state changes.
 */
// SQLite only on purpose: it substitutes NodeSqliteProvider, the D1 emulation.
describe.skipIf(onPostgres)("Project events", () => {
  let alepha: Alepha;
  let rows: EventRows;
  let database: FailingDatabase;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  const events = (name?: string, projectId = project.id) =>
    rows.events.findMany({
      where: { projectId, ...(name ? { name } : {}) },
    });

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        DATABASE_TRANSACTIONS: false,
        SERVER_PORT: 0,
        LOG_LEVEL: "silent",
      },
    });
    alepha.with({ provide: DatabaseProvider, use: NodeSqliteProvider });
    alepha.with({ provide: LoreDatabase, use: FailingDatabase });
    alepha.with({ provide: JobQueueProvider, use: SilentQueue });
    alepha.with({ provide: CronProvider, use: ManualCronProvider });
    bootLore(alepha);
    rows = alepha.inject(EventRows);
    database = alepha.inject(FailingDatabase);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [
        {
          key: "plan",
          options: { epics: true, releases: true, feedback: true },
        },
        { key: "ship", options: { deploy: true, uptime: true } },
      ],
    });
    await rows.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] } as UserAccountToken;
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("lists every event with its fields, capability, permission and filter, registered by its package", async ({
    expect,
  }) => {
    const catalog = alepha.inject(ProjectEventCatalog).all();
    expect(catalog.map((event) => event.name).sort()).toEqual([
      "agent.job.failed",
      "agent.job.succeeded",
      "coverage.dropped",
      "deploy.failed",
      "deploy.succeeded",
      "epic.completed",
      "epic.created",
      "epic.ready",
      "error.trusted",
      "errors.threshold_crossed",
      "feedback.commented",
      "feedback.created",
      "feedback.trusted",
      "host.credential_invalid",
      "host.expired",
      "host.offline",
      "host.online",
      "host.resource_high",
      "host.resource_ok",
      "host.unit_failed",
      "host.unit_recovered",
      "monitor.down",
      "monitor.up",
      "prompt.ceiling.reached",
      "prompt.disabled",
      "pull_request.added",
      "quest.assigned",
      "quest.completed",
      "quest.created",
      "quest.held",
      "quest.reminder_due",
      "release.published",
    ]);
    for (const event of catalog) {
      expect(event.permission).toMatch(/^[a-z]+:read$/);
      expect(event.label).not.toBe("");
    }
    expect(
      catalog.find((event) => event.name === "deploy.failed")?.filter,
    ).toEqual({ field: "app", resource: "app" });
  });

  it("records feedback with its generated id, in the batch of the submit", async ({
    expect,
  }) => {
    const submitted = await alepha
      .inject(FeedbackController)
      .submitFeedback.fetch(
        {
          params: { projectId: project.id },
          body: { title: "Broken", description: "Steps" },
        },
        { user },
      );
    const row = await rows.feedback.getById(submitted.data.id);
    const [event] = await events("feedback.created");
    expect(event).toMatchObject({
      subjectKind: "feedback",
      subjectId: String(row.shortId),
      fields: {
        feedback_id: submitted.data.id,
        shortId: row.shortId,
        title: "Broken",
        project: project.title,
      },
    });
  });

  it("leaves no event when the change is refused", async ({ expect }) => {
    database.fail = true;
    await expect(
      alepha.inject(FeedbackController).submitFeedback.fetch(
        {
          params: { projectId: project.id },
          body: { title: "Lost", description: "Steps" },
        },
        { user },
      ),
    ).rejects.toThrow();
    database.fail = false;
    expect(await events()).toHaveLength(0);
    expect(await rows.feedback.count({ projectId: project.id })).toBe(0);
  });

  it("records a quest's creation, acceptance, hold and completion, and nothing for a plain edit", async ({
    expect,
  }) => {
    const quests = alepha.inject(QuestController);
    const created = await quests.createQuest.fetch(
      {
        body: {
          projectId: project.id,
          title: "Ship it",
          area: "api",
          priority: "medium",
        },
      },
      { user },
    );
    const id = created.data.id;
    expect(await events("quest.created")).toEqual([
      expect.objectContaining({
        subjectId: String(created.data.shortId),
        fields: expect.objectContaining({
          quest_id: id,
          shortId: created.data.shortId,
          area: "api",
          actor_id: user.id,
        }),
      }),
    ]);

    await quests.updateQuestById.fetch(
      { params: { id }, body: { title: "Ship it now" } },
      { user },
    );
    expect(await events()).toHaveLength(1);

    await quests.acceptQuest.fetch({ params: { id } }, { user });
    const [assigned] = await events("quest.assigned");
    expect(assigned.fields).toMatchObject({
      assignee_id: user.id,
      actor_id: user.id,
      title: "Ship it now",
    });

    await quests.holdQuest.fetch(
      { params: { id }, body: { reason: "Waiting on a decision" } },
      { user },
    );
    expect(await events("quest.held")).toHaveLength(1);
    expect((await rows.quests.getById(id)).heldAt).toBeDefined();
  });

  it("records an epic's and a quest's completion once", async ({ expect }) => {
    const epic = await createTestEpic(alepha, project, {
      status: "in_progress",
    });
    const quest = await createTestQuest(alepha, project, {
      epicId: epic.id,
      acceptedAt: alepha.inject(DateTimeProvider).nowISOString(),
      acceptedBy: user.id,
    });
    await alepha
      .inject(QuestController)
      .completeQuest.fetch({ params: { id: quest.id }, body: {} }, { user });
    expect(await events("quest.completed")).toHaveLength(1);
    const [completed] = await events("epic.completed");
    expect(completed).toMatchObject({
      subjectId: String(epic.number),
      fields: { epic_id: epic.id, quest_count: 1 },
    });
  });

  it("records a published release", async ({ expect }) => {
    const releases = alepha.inject(ReleaseController);
    const release = await releases.createRelease.fetch(
      { params: { projectId: project.id }, body: { tag: "1.0.0" } },
      { user },
    );
    await releases.publishRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user },
    );
    const [event] = await events("release.published");
    expect(event.fields).toMatchObject({
      release_tag: "1.0.0",
      publisher_id: user.id,
      quest_count: 0,
    });
  });

  it("records deploy outcomes as data, with the app as the filter field", async ({
    expect,
  }) => {
    const instance = await rows.instances.create({
      projectId: project.id,
      app: "site",
      env: "preview",
      createdBy: user.id,
    });
    const deployment = await rows.deployments.create({
      projectId: project.id,
      instanceId: instance.id,
      app: "site",
      tag: "latest",
      sha256: "a".repeat(64),
      status: "running",
    });
    await alepha
      .inject(DeployRegistry)
      .failed(deployment.id, "Authorization: Bearer SECRET");
    const [event] = await events("deploy.failed");
    expect(event).toMatchObject({
      subjectKind: "deployment",
      subjectId: deployment.id,
      fields: { app: "site", env: "preview", title: "site", reason: "failed" },
    });
    expect(JSON.stringify(event)).not.toContain("SECRET");
  });

  it("records a monitor's outage and recovery as data", async ({ expect }) => {
    const time = alepha.inject(DateTimeProvider);
    time.pause();
    const monitor = await rows.monitors.create({
      projectId: project.id,
      name: "Website",
      kind: "http",
      target: "https://example.test/health?token=abc",
      confirmations: 1,
      statusSince: time.nowISOString(),
      nextCheckAt: time.nowISOString(),
    });
    const probe = async (ok: boolean) => {
      await time.travel(1, "minute");
      return alepha
        .inject(UptimeStateService)
        .apply(
          await rows.monitors.getById(monitor.id),
          ok
            ? { ok: true, result: "up", latencyMs: 20 }
            : { ok: false, result: "connection", latencyMs: 0 },
          time.nowMillis(),
        );
    };
    await probe(false);
    await probe(true);
    const [down] = await events("monitor.down");
    expect(down).toMatchObject({
      subjectKind: "monitor",
      subjectId: monitor.id,
      fields: {
        monitor_id: monitor.id,
        title: "Website",
        state: "down",
        target: "https://example.test/health",
      },
    });
    expect((await events("monitor.up"))[0].fields).toMatchObject({
      state: "up",
    });
  });

  it("prunes events older than 30 days, and keeps the rest", async ({
    expect,
  }) => {
    const time = alepha.inject(DateTimeProvider);
    for (const days of [31, 29])
      await rows.events.create({
        projectId: project.id,
        name: "quest.created",
        subjectKind: "quest",
        fields: {},
        occurredAt: time.now().subtract(days, "days").toISOString(),
      });
    expect(await alepha.inject(ProjectEvents).prune()).toBe(1);
    expect(await events()).toHaveLength(1);
  });

  it("drops a deleted project's events and carries a merged project's", async ({
    expect,
  }) => {
    const seed = (projectId: number) =>
      rows.events.create({
        projectId,
        name: "quest.created",
        subjectKind: "quest",
        fields: {},
        occurredAt: alepha.inject(DateTimeProvider).nowISOString(),
      });
    const source = await createTestProject(alepha, {
      createdBy: project.createdBy,
    });
    await seed(source.id);
    await seed(project.id);
    await alepha.inject(ProjectMergeService).merge(source.id, project.id);
    expect(await events(undefined, project.id)).toHaveLength(2);

    const doomed = await createTestProject(alepha, {
      createdBy: project.createdBy,
    });
    await seed(doomed.id);
    await alepha
      .inject(ProjectDeletionService)
      .deleteProject(doomed.id, { force: true });
    expect(await events(undefined, doomed.id)).toHaveLength(0);
  });
});
