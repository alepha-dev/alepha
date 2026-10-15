import {
  AutomationClaims,
  AutomationDatabase,
  AutomationEvents,
  AutomationOrigin,
  AutomationPersistence,
  AutomationSqliteProvider,
} from "@lore/core/api";
import { DeployJobs, DeployRegistry } from "@lore/deploy/api";
import { appInstances, deployments } from "@lore/deploy/schemas";
import {
  FeedbackController,
  QuestController,
  ReleaseController,
  EpicWorkflowService,
} from "@lore/work/api";
import { Alepha, AlephaError, $inject, $hook, z } from "alepha";
import {
  $job,
  JobQueueProvider,
  JobProvider,
  JobService,
  jobExecutionEntity,
} from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider, type SQLLike, sql } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  TestEntityRepositories,
  createTestProject,
  createTestQuest,
  createTestEpic,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class SourceRows extends TestEntityRepositories {
  instances = $repository(appInstances);
  deployments = $repository(deployments);
  jobs = $repository(jobExecutionEntity);
}
class RecordingDispatcher extends JobQueueProvider {
  public readonly kind = "queue" as const;
  public readonly delivered: string[] = [];
  public async dispatch(_name: string, id: string) {
    this.delivered.push(id);
  }
}
class SourceDatabase extends AutomationDatabase {
  public failEvents = false;
  public override batch(statements: SQLLike[]) {
    if (!this.failEvents) return super.batch(statements);
    return super.batch([
      ...statements,
      sql`INSERT INTO missing_automation_source_test_table (id) VALUES (1)`,
    ]);
  }
}
class SourceProbe {
  protected readonly feedback = $inject(FeedbackController);
  protected readonly entities = $inject(SourceRows);
  public writes = 0;
  public fail = false;
  public readonly child = $job({
    name: "e43.source-test",
    description: "Writes test feedback to verify trusted job origin.",
    schema: z.object({
      projectId: z.integer(),
      title: z.string(),
      origin: z.boolean().optional(),
    }),
    retention: { ok: { days: 30 }, error: { days: 30 } },
    handler: async ({ payload }) => {
      if (this.fail) throw new AlephaError("Test failure before source write");
      const project = await this.entities.projects.getById(payload.projectId);
      await this.feedback.submitFeedback(
        {
          params: { projectId: project.id },
          body: { title: payload.title, description: "Description" },
        },
        { user: { id: project.createdBy, roles: ["user"] } },
      );
    },
  });
  protected readonly writesHook = $hook({
    on: "repository:create:after",
    handler: ({ tableName }) => {
      if (tableName === "feedback") this.writes += 1;
    },
  });
}

describe("Automation domain source integration", () => {
  let alepha: Alepha;
  let rows: SourceRows;
  let persistence: AutomationPersistence;
  let database: SourceDatabase;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  let probe: SourceProbe;
  const submit = (title = "Feedback") =>
    alepha.inject(FeedbackController).submitFeedback.fetch(
      {
        params: { projectId: project.id },
        body: { title, description: "Safe description" },
      },
      { user },
    );
  const rule = async (
    event: "feedback.created" | "quest.completed" = "feedback.created",
  ) => {
    const row = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Source rule",
      rule: {
        version: 1,
        trigger: { kind: "event", event },
        select: null,
        guard: null,
        actions: [
          {
            kind: "notify",
            recipient: user.id,
            channel: "inbox",
            title: "Source",
            text: "{{title}}",
            category: "automations",
          },
        ],
      },
    });
    return persistence.rules.updateById(row.id, { enabled: true });
  };
  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        DATABASE_TRANSACTIONS: false,
        SERVER_PORT: 0,
        LOG_LEVEL: "silent",
      },
    });
    alepha.with({ provide: DatabaseProvider, use: AutomationSqliteProvider });
    alepha.with({ provide: AutomationDatabase, use: SourceDatabase });
    alepha.with({ provide: JobQueueProvider, use: RecordingDispatcher });
    alepha.with({ provide: CronProvider, use: ManualCronProvider });
    bootLore(alepha);
    rows = alepha.inject(SourceRows);
    probe = alepha.inject(SourceProbe);
    persistence = alepha.inject(AutomationPersistence);
    database = alepha.inject(SourceDatabase);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [
        { key: "support" },
        {
          key: "work",
          options: { automations: true, epics: true, releases: true },
        },
        { key: "apps", options: { deploy: true } },
      ],
    });
    await rows.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] } as UserAccountToken;
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("captures feedback with its generated stable ID and keeps domain hooks", async ({
    expect,
  }) => {
    const submitted = await submit();
    const event = await persistence.events.getOne({
      where: { name: "feedback.created" },
    });
    expect(event.payload.fields).toMatchObject({
      feedback_id: submitted.data.id,
      title: "Feedback",
      project: project.title,
    });
    expect(event.payload.fields).not.toHaveProperty("reporterUserId");
    expect(probe.writes).toBe(1);
  });
  it("rolls back the source and intent together when the native batch fails", async ({
    expect,
  }) => {
    database.failEvents = true;
    await expect(submit()).rejects.toThrow("not committed");
    expect(await rows.feedback.count({ projectId: project.id })).toBe(0);
    expect(await persistence.events.count({ projectId: project.id })).toBe(0);
    expect(probe.writes).toBe(0);
  });
  it("reserves each matching human event once and suppresses automation chaining", async ({
    expect,
  }) => {
    const matching = await rule();
    await rule("quest.completed");
    const paused = await rule();
    await persistence.rules.updateById(paused.id, {
      health: "paused",
      requiresApproval: true,
    });
    await submit("Human source");
    const events = alepha.inject(AutomationEvents);
    expect(await events.sweep()).toBe(1);
    expect(await events.sweep()).toBe(0);
    expect(
      await persistence.receipts.findMany({ where: { kind: "occurrence" } }),
    ).toMatchObject([
      {
        automationId: matching.id,
        status: "ready",
        ruleRevision: matching.revision,
      },
    ]);
    await alepha
      .inject(AutomationOrigin)
      .run({ projectId: project.id, automationId: matching.id }, () =>
        alepha.inject(FeedbackController).submitFeedback(
          {
            params: { projectId: project.id },
            body: { title: "Automation source", description: "Description" },
          },
          { user },
        ),
      );
    expect(probe.writes).toBe(2);
    expect(await rows.feedback.count({ projectId: project.id })).toBe(2);
    expect(await persistence.events.count({ projectId: project.id })).toBe(1);
    expect(await events.sweep()).toBe(0);
  });
  it("retains trusted origin across queued, bulk and manually retried jobs without trusting payload fields", async ({
    expect,
  }) => {
    const jobs = alepha.inject(JobProvider);
    const origin = alepha.inject(AutomationOrigin);
    const ids = await origin.run({ projectId: project.id }, () =>
      probe.child.pushMany([
        { payload: { projectId: project.id, title: "First" } },
        { payload: { projectId: project.id, title: "Second" } },
      ]),
    );
    expect(origin.current).toBeUndefined();
    for (const id of ids) await jobs.processExecution(probe.child.name, id);
    expect(await persistence.events.count({ projectId: project.id })).toBe(0);
    expect(probe.writes).toBe(2);
    expect(origin.current).toBeUndefined();
    const humanId = await probe.child.push({
      projectId: project.id,
      title: "Payload cannot claim provenance",
      origin: true,
    });
    expect(
      await persistence.receipts.findById(`job-origin:${humanId}`),
    ).toBeUndefined();
    await jobs.processExecution(probe.child.name, humanId);
    expect(await rows.jobs.getById(humanId)).toMatchObject({ status: "ok" });
    expect(probe.writes).toBe(3);
    expect(await persistence.events.count({ projectId: project.id })).toBe(1);
    probe.fail = true;
    const failedId = await origin.run({ projectId: project.id }, () =>
      probe.child.push({ projectId: project.id, title: "Retry" }),
    );
    await jobs.processExecution(probe.child.name, failedId);
    expect((await rows.jobs.getById(failedId)).status).toBe("error");
    probe.fail = false;
    await alepha.inject(JobService).retryExecution(failedId);
    const retry = await rows.jobs.getOne({
      where: { jobName: probe.child.name, status: "pending" },
    });
    await jobs.processExecution(probe.child.name, retry.id);
    expect(probe.writes).toBe(4);
    expect(await persistence.events.count({ projectId: project.id })).toBe(1);
  });
  it("retains provenance for a retained job beyond the replay horizon and prunes only orphaned markers", async ({
    expect,
  }) => {
    const origin = alepha.inject(AutomationOrigin);
    const id = await origin.run({ projectId: project.id }, () =>
      probe.child.push({ projectId: project.id, title: "Retained job" }),
    );
    await alepha.inject(JobProvider).processExecution(probe.child.name, id);
    await persistence.receipts.updateById(`job-origin:${id}`, {
      replayUntil: alepha
        .inject(DateTimeProvider)
        .now()
        .subtract(91, "days")
        .toISOString(),
    });
    await alepha.inject(AutomationClaims).prune();
    expect(await origin.prune()).toBe(0);
    expect(
      await persistence.receipts.findById(`job-origin:${id}`),
    ).toBeDefined();
    await rows.jobs.deleteById(id);
    expect(await origin.prune()).toBe(1);
    expect(
      await persistence.receipts.findById(`job-origin:${id}`),
    ).toBeUndefined();
  });
  it("captures actual quest and epic completion exactly once, and never a ready all-shelved epic", async ({
    expect,
  }) => {
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
    expect((await rows.epics.getById(epic.id)).status).toBe("completed");
    expect(await persistence.events.count({ name: "quest.completed" })).toBe(1);
    expect(await persistence.events.count({ name: "epic.completed" })).toBe(1);
    await alepha.inject(EpicWorkflowService).completeIfResolved(quest, user);
    expect(await persistence.events.count({ name: "epic.completed" })).toBe(1);
    const ready = await createTestEpic(alepha, project, { status: "ready" });
    const shelved = await createTestQuest(alepha, project, {
      epicId: ready.id,
      shelvedAt: alepha.inject(DateTimeProvider).nowISOString(),
    });
    await alepha.inject(EpicWorkflowService).completeIfResolved(shelved, user);
    expect((await rows.epics.getById(ready.id)).status).toBe("ready");
    expect(await persistence.events.count({ name: "epic.completed" })).toBe(1);
  });
  it("freezes publication data and uses a fresh identity after reopening", async ({
    expect,
  }) => {
    const controller = alepha.inject(ReleaseController);
    const release = await controller.createRelease.fetch(
      { params: { projectId: project.id }, body: { tag: "1.0.0" } },
      { user },
    );
    await controller.publishRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user },
    );
    const first = await persistence.events.getOne({
      where: { name: "release.published" },
    });
    expect(first.payload.fields).toMatchObject({
      release_id: release.data.id,
      release_tag: "1.0.0",
      publisher_id: user.id,
      quest_count: 0,
    });
    expect(first.payload.fields.changelog).toBe(
      (await rows.releases.getById(release.data.id)).changelog,
    );
    await controller.reopenRelease.fetch(
      { params: { id: release.data.id } },
      { user },
    );
    await controller.publishRelease.fetch(
      {
        params: { id: release.data.id },
        body: { title: "Second publication" },
      },
      { user },
    );
    const events = await persistence.events.findMany({
      where: { name: "release.published" },
    });
    expect(events).toHaveLength(2);
    expect(new Set(events.map((event) => event.identity)).size).toBe(2);
    expect((await persistence.events.getById(first.id)).payload).toEqual(
      first.payload,
    );
  });
  it("records deploy terminal facts once, exposes recording failures and omits raw errors and logs", async ({
    expect,
  }) => {
    const instance = await rows.instances.create({
      projectId: project.id,
      app: "site",
      env: "preview",
      createdBy: user.id,
    });
    const deploy = () =>
      rows.deployments.create({
        projectId: project.id,
        instanceId: instance.id,
        app: "site",
        tag: "latest",
        sha256: "a".repeat(64),
        status: "running",
      });
    const registry = alepha.inject(DeployRegistry);
    const failed = await deploy();
    expect(
      await registry.failed(
        failed.id,
        "Authorization: Bearer SECRET; private deployment logs",
      ),
    ).toBe(true);
    expect(await registry.failed(failed.id, "repeat")).toBe(true);
    const succeeded = await deploy();
    expect(
      await registry.succeeded(succeeded.id, { url: "https://site.test" }),
    ).toBe(true);
    const captured = await persistence.events.findMany({
      where: { projectId: project.id },
    });
    expect(captured.map((event) => event.name).sort()).toEqual([
      "deploy.failed",
      "deploy.succeeded",
    ]);
    expect(JSON.stringify(captured)).not.toContain("SECRET");
    expect(JSON.stringify(captured)).not.toContain("private deployment logs");
    expect(captured[0].payload.fields).toMatchObject({
      app: "site",
      env: "preview",
      tag: "latest",
      digest: "a".repeat(64),
    });
    database.failEvents = true;
    const unrecorded = await deploy();
    expect(await registry.failed(unrecorded.id, "Failure")).toBe(false);
    expect((await rows.deployments.getById(unrecorded.id)).status).toBe(
      "running",
    );
    expect(await persistence.events.count({ projectId: project.id })).toBe(2);
  });
  it("captures the timeout failure path through the same terminal adapter", async ({
    expect,
  }) => {
    const instance = await rows.instances.create({
      projectId: project.id,
      app: "site",
      env: "production",
    });
    const stale = alepha
      .inject(DateTimeProvider)
      .now()
      .subtract(2, "hours")
      .toISOString();
    const deployment = await rows.deployments.create({
      projectId: project.id,
      instanceId: instance.id,
      app: "site",
      tag: "latest",
      sha256: "a".repeat(64),
      status: "running",
      startedAt: stale,
      createdAt: stale,
    });
    await alepha.inject(DeployJobs).sweepAbandoned.trigger();
    expect((await rows.deployments.getById(deployment.id)).status).toBe(
      "failed",
    );
    expect(
      (await persistence.events.getOne({ where: { name: "deploy.failed" } }))
        .payload.fields.reason,
    ).toBe("Deployment stopped reporting and was abandoned.");
  });
});
