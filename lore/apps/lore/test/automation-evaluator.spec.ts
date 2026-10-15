import {
  AutomationClaims,
  AutomationContextBuilder,
  AutomationDispatchRegistry,
  AutomationEvaluator,
  AutomationGuards,
  AutomationMutationContext,
  AutomationPersistence,
  AutomationSelections,
  AutomationWorker,
  AutomationWorkerJobs,
  type AutomationSelected,
} from "@lore/core/api";
import type { AutomationRule } from "@lore/core/schemas";
import { $hook, $inject, Alepha, AlephaError } from "alepha";
import { audits } from "alepha/api/audits";
import {
  JobProvider,
  JobQueueProvider,
  jobExecutionEntity,
} from "alepha/api/jobs";
import { notificationInboxEntity } from "alepha/api/notifications";
import { RankService } from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMember,
  createTestFolio,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class HeldAutomationQueue extends JobQueueProvider {
  public dispatched: string[] = [];
  public override async dispatch(_name: string, id: string) {
    this.dispatched.push(id);
  }
}
class EvaluationRows {
  public readonly jobs = $repository(jobExecutionEntity);
  public readonly audits = $repository(audits);
  public readonly inbox = $repository(notificationInboxEntity);
}
class ControlledSelections extends AutomationSelections {
  protected readonly contexts = $inject(AutomationContextBuilder);
  public scalar?: number;
  public override async evaluate(
    input: Parameters<AutomationSelections["evaluate"]>[0],
  ): Promise<AutomationSelected> {
    if (
      input.rule.rule.select?.key !== "openBlights" ||
      this.scalar === undefined
    )
      return super.evaluate(input);
    const context = await this.contexts.source(
      input.rule.projectId,
      "openBlights",
      { value: this.scalar },
    );
    return {
      kind: "scalar",
      contexts: [context],
      items: [context.values],
      total: 1,
      totalIsExact: true,
      hasMore: false,
      truncated: false,
      noData: false,
      evaluatedAt: input.evaluatedAt!,
    };
  }
}
class EvaluationFaults {
  protected readonly mutations = $inject(AutomationMutationContext);
  public after?: () => Promise<void>;
  protected readonly hook = $hook({
    on: "repository:update:after",
    handler: async ({ tableName }) => {
      if (tableName !== "folios" || !this.mutations.current || !this.after)
        return;
      const run = this.after;
      this.after = undefined;
      await run();
    },
  });
}

describe("Pure automation evaluation and durable worker", () => {
  let alepha: Alepha;
  let persistence: AutomationPersistence;
  let entities: TestEntityRepositories;
  let evaluator: AutomationEvaluator;
  let worker: AutomationWorker;
  let rows: EvaluationRows;
  let time: DateTimeProvider;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  const notify = (text = "{{title}}") => ({
    kind: "notify" as const,
    recipient: user.id,
    channel: "inbox",
    title: "Automation",
    text,
    category: "automations" as const,
  });
  const ast = (): AutomationRule => ({
    version: 1,
    trigger: { kind: "event", event: "quest.completed" },
    select: null,
    guard: null,
    actions: [notify()],
  });
  const create = (rule = ast()) =>
    persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Rule",
      rule,
    });
  const state = async () =>
    JSON.stringify(
      await Promise.all([
        persistence.rules.findMany(),
        persistence.variables.findMany(),
        persistence.runs.findMany(),
        persistence.receipts.findMany(),
        persistence.events.findMany(),
        entities.quests.findMany(),
        entities.folios.findMany(),
        entities.areas.findMany(),
        rows.jobs.findMany(),
        rows.audits.findMany(),
        rows.inbox.findMany(),
      ]),
    );
  const reserve = async (
    rule: Awaited<ReturnType<typeof create>>,
    fields?: Record<string, string | number | boolean | null>,
  ) => {
    await persistence.rules.updateById(rule.id, { enabled: true });
    const event =
      rule.rule.trigger.kind === "event"
        ? await persistence.events.create({
            projectId: project.id,
            identity: crypto.randomUUID(),
            name: rule.rule.trigger.event,
            occurredAt: time.nowISOString(),
            replayUntil: time.now().add(90, "days").toISOString(),
            payload: {
              fields: fields ?? { title: "Original source" },
              omitted: [],
            },
          })
        : undefined;
    return alepha.inject(AutomationClaims).reserve({
      automationId: rule.id,
      revision: rule.revision,
      source: event
        ? { kind: "event", eventId: event.id }
        : { kind: "schedule", scheduledAt: time.nowISOString() },
    });
  };
  const finish = async (id: string) => {
    let next: { receiptId: string; token?: string } | undefined = {
      receiptId: id,
    };
    for (let step = 0; next && step < 80; step++)
      next = await worker.step(next, 3);
    if (next) throw new AlephaError("Worker exceeded the test's bounded steps");
  };
  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: HeldAutomationQueue })
      .with({ provide: AutomationSelections, use: ControlledSelections });
    bootLore(alepha);
    persistence = alepha.inject(AutomationPersistence);
    entities = alepha.inject(TestEntityRepositories);
    evaluator = alepha.inject(AutomationEvaluator);
    worker = alepha.inject(AutomationWorker);
    rows = alepha.inject(EvaluationRows);
    time = alepha.inject(DateTimeProvider);
    alepha.inject(EvaluationFaults);
    await alepha.start();
    time.pause();
    project = await createTestProject(alepha, {
      capabilities: [
        {
          key: "work",
          options: {
            automations: true,
            releases: true,
            epics: true,
            reminder: true,
          },
        },
        { key: "knowledge" },
        { key: "support" },
        {
          key: "apps",
          options: { track: true, quality: true, deploy: true },
        },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("previews a disabled rule with exact messages and a prospective same-project subject without writes", async ({
    expect,
  }) => {
    const quest = await createTestQuest(alepha, project, {
      title: "Actual <quest>",
      area: "ops",
    });
    const rule = await create();
    const before = await state();
    const report = await evaluator.test(rule.id, user, {
      kind: "subject",
      id: quest.id,
    });
    expect(report).toMatchObject({
      preview: true,
      status: "preview",
      source: {
        mode: "prospective",
        key: "quest.completed",
        id: String(quest.id),
      },
      counts: { selected: 1, matched: 1, executed: 0, deliveries: 0 },
      operations: [
        {
          action: { text: "Actual <quest>" },
          rendered: { text: "Actual <quest>" },
          lang: "en",
        },
      ],
    });
    expect(report.evaluatedAt).toBe(time.nowISOString());
    expect(await state()).toBe(before);
  });
  it("refuses foreign subjects and arbitrary event JSON while leaving every execution store unchanged", async ({
    expect,
  }) => {
    const foreign = await createTestProject(alepha);
    const quest = await createTestQuest(alepha, foreign);
    const rule = await create();
    const before = await state();
    expect(
      (await evaluator.test(rule.id, user, { kind: "subject", id: quest.id }))
        .status,
    ).toBe("refused");
    expect(
      (
        await evaluator.test(rule.id, user, {
          kind: "subject",
          id: quest.id,
          fields: { title: "untrusted" },
        } as never)
      ).status,
    ).toBe("refused");
    expect(await state()).toBe(before);
  });
  it("uses retained historical inputs rather than rereading a renamed subject", async ({
    expect,
  }) => {
    const rule = await create();
    const occurrence = await reserve(rule, {
      title: "Frozen historical title",
      shortId: 4,
      quest_id: 55,
    });
    await finish(occurrence.id);
    const run = (
      await persistence.runs.findMany({ where: { automationId: rule.id } })
    )[0];
    const before = await state();
    expect(
      await evaluator.test(rule.id, user, { kind: "run", id: run.id }),
    ).toMatchObject({
      source: { mode: "historical", id: run.id },
      operations: [{ action: { text: "Frozen historical title" } }],
    });
    expect(await state()).toBe(before);
    await persistence.runs.updateById(run.id, {
      finishedAt: time.now().subtract(31, "days").toISOString(),
    });
    expect(
      (await evaluator.test(rule.id, user, { kind: "run", id: run.id })).reason,
    ).toContain("retention");
  });
  it("reports a missing quality day as no_data and an empty collection as no action", async ({
    expect,
  }) => {
    const rule = ast();
    rule.trigger = { kind: "schedule", cron: "10 0 * * *" };
    rule.select = {
      kind: "scalar",
      key: "quality.coverage.lines",
      filters: { branch: "missing" },
    };
    rule.guard = { field: "value", operator: "delta", value: 1 };
    rule.actions = [notify("Coverage {{value}}")];
    const quality = await create(rule);
    const before = await state();
    expect(await evaluator.test(quality.id, user)).toMatchObject({
      status: "preview",
      noData: true,
      counts: { selected: 1, matched: 0 },
      operations: [],
    });
    expect(await state()).toBe(before);
    rule.select = {
      kind: "collection",
      key: "quests.tagged",
      filters: { tag: "nightly" },
    };
    rule.guard = null;
    rule.actions = [notify("{{summary}}")];
    const collection = await create(rule);
    const empty = await state();
    expect(await evaluator.test(collection.id, user)).toMatchObject({
      status: "preview",
      noData: false,
      counts: { selected: 0, matched: 0 },
      operations: [],
    });
    expect(await state()).toBe(empty);
  });
  it("preserves collection item fields and reports the 50-row cap and final escaping truncation", async ({
    expect,
  }) => {
    for (let index = 0; index < 52; index++)
      await createTestQuest(alepha, project, {
        title: `<${"&".repeat(180)}> ${index}`,
        tags: ["nightly"],
      });
    const rule = ast();
    rule.trigger = { kind: "schedule", cron: "0 0 * * *" };
    rule.select = {
      kind: "collection",
      key: "quests.tagged",
      filters: { tag: "nightly" },
    };
    rule.actions = [{ ...notify("{{summary}}"), channel: "email" }];
    const stored = await create(rule);
    const before = await state();
    const report = await evaluator.test(stored.id, user);
    expect(report).toMatchObject({
      status: "preview",
      counts: { selected: 50, matched: 50, hasMore: true, truncated: true },
      operations: [{ truncated: true }],
    });
    expect(report.selected[0]).toHaveProperty("quest_id");
    expect(report.operations[0].bytes).toBeLessThanOrEqual(16_384);
    const operation = report.operations[0];
    if (operation.delivery)
      expect(
        new TextEncoder().encode(
          JSON.stringify({
            ...operation.rendered,
            text: operation.delivery.html,
          }),
        ).byteLength,
      ).toBeLessThanOrEqual(16_384);
    expect(await state()).toBe(before);
  });
  it("previews writes without history, counter, area, audit or health mutations even on refusals", async ({
    expect,
  }) => {
    const folio = await createTestFolio(alepha, project);
    const quest = await createTestQuest(alepha, project);
    const rule = ast();
    rule.actions = [
      { kind: "appendFolio", folio: folio.id, text: "Appended {{title}}" },
      {
        kind: "createQuest",
        title: "Follow-up",
        description: "{{title}}",
        area: "new-area",
      },
    ];
    const stored = await create(rule);
    const before = await state();
    expect(
      await evaluator.test(stored.id, user, { kind: "subject", id: quest.id }),
    ).toMatchObject({
      status: "preview",
      operations: [
        { action: { text: `Appended ${quest.title}` }, changed: true },
        { action: { area: "new-area" } },
      ],
    });
    expect(await state()).toBe(before);
    await entities.organizationMembers.deleteMany({
      organizationId: project.organizationId!,
      userId: user.id,
    });
    const refused = await state();
    await expect(
      evaluator.test(stored.id, user, { kind: "subject", id: quest.id }),
    ).rejects.toThrow("current member");
    expect(await state()).toBe(refused);
  });
  it("executes the shared frozen plan and reconciles a post-commit crash without duplicating append or audit", async ({
    expect,
  }) => {
    const folio = await createTestFolio(alepha, project, { content: "Before" });
    const rule = ast();
    rule.actions = [
      { kind: "appendFolio", folio: folio.id, text: "{{title}}" },
      {
        kind: "createQuest",
        title: "Created {{title}}",
        description: "Body",
        area: "ops",
      },
    ];
    const stored = await create(rule);
    const occurrence = await reserve(stored, { title: "Original" });
    alepha.inject(EvaluationFaults).after = async () => {
      throw new AlephaError("Lost acknowledgement");
    };
    await finish(occurrence.id);
    expect((await entities.folios.getById(folio.id)).content).toBe(
      "Before\n\nOriginal",
    );
    expect(await entities.quests.count({ projectId: project.id })).toBe(1);
    expect(
      await rows.audits.count({
        scopeId: String(project.id),
        action: "update",
        type: "folio",
      }),
    ).toBe(1);
    expect(
      (
        await persistence.runs.findMany({ where: { automationId: stored.id } })
      )[0],
    ).toMatchObject({
      status: "succeeded",
      snapshot: { counts: { executed: 2 } },
    });
    await finish(occurrence.id);
    expect(await entities.quests.count({ projectId: project.id })).toBe(1);
  });
  it("stops after authority loss between actions and retains the prior committed effect", async ({
    expect,
  }) => {
    const folio = await createTestFolio(alepha, project, { content: "Before" });
    const rule = ast();
    rule.actions = [
      { kind: "appendFolio", folio: folio.id, text: "Once" },
      {
        kind: "createQuest",
        title: "Must not happen",
        description: "",
        area: "ops",
      },
    ];
    const stored = await create(rule);
    const occurrence = await reserve(stored);
    alepha.inject(EvaluationFaults).after = async () => {
      await entities.organizationMembers.deleteMany({
        organizationId: project.organizationId!,
        userId: user.id,
      });
    };
    await finish(occurrence.id);
    expect((await entities.folios.getById(folio.id)).content).toBe(
      "Before\n\nOnce",
    );
    expect(await entities.quests.count({ projectId: project.id })).toBe(0);
    expect(
      (
        await persistence.runs.findMany({
          where: {
            automationId: stored.id,
            occurrenceId: occurrence.occurrenceId,
          },
        })
      )[0],
    ).toMatchObject({
      status: "partial",
      snapshot: {
        counts: { executed: 1 },
        actions: [{ status: "succeeded" }, { status: "skipped" }],
      },
    });
  });
  it("uses the original crossing observation and writes no baseline during repeated previews", async ({
    expect,
  }) => {
    const rule = ast();
    rule.trigger = { kind: "schedule", cron: "*/5 * * * *" };
    rule.select = { kind: "scalar", key: "openBlights", filters: {} };
    rule.guard = { field: "value", operator: "crossesAbove", value: 2 };
    rule.actions = [notify("Count {{value}}")];
    const stored = await create(rule);
    alepha.inject(ControlledSelections).scalar = 1;
    const first = await evaluator.test(stored.id, user);
    expect(first.counts.matched).toBe(0);
    expect(
      (await persistence.rules.getById(stored.id)).baseline,
    ).toBeUndefined();
    const signature = (
      await alepha
        .inject(AutomationGuards)
        .evaluate({ rule: stored, context: { value: 1 }, variables: [] })
    ).signature!;
    await persistence.rules.updateById(stored.id, {
      baseline: { signature, value: 1 },
    });
    alepha.inject(ControlledSelections).scalar = 3;
    const ready = await reserve(await persistence.rules.getById(stored.id));
    await finish(ready.id);
    expect((await persistence.rules.getById(stored.id)).baseline?.value).toBe(
      3,
    );
    expect(
      await persistence.receipts.count({ parentId: ready.id, kind: "guard" }),
    ).toBe(1);
    expect(
      await rows.jobs.count({ jobName: "system.notifications.send" }),
    ).toBe(1);
    const run = (
      await persistence.runs.findMany({
        where: { automationId: stored.id, occurrenceId: ready.occurrenceId },
      })
    )[0];
    expect(run).toMatchObject({
      status: "succeeded",
      snapshot: { counts: { deliveries: 1 } },
    });
  });
  it("continues 150 deliveries in bounded runs without fetching the fifty-first selected row", async ({
    expect,
  }) => {
    for (let index = 0; index < 52; index++)
      await createTestQuest(alepha, project, {
        tags: ["urgent"],
        title: `Quest ${index}`,
      });
    const rule = ast();
    rule.trigger = { kind: "schedule", cron: "*/5 * * * *" };
    rule.select = {
      kind: "rows",
      key: "quests.open",
      filters: { tag: "urgent" },
    };
    rule.actions = [
      notify("First {{quest_id}}"),
      notify("Second {{quest_id}}"),
      notify("Third {{quest_id}}"),
    ];
    const stored = await create(rule);
    const occurrence = await reserve(stored);
    await finish(occurrence.id);
    const runs = await persistence.runs.findMany({
      where: { automationId: stored.id, occurrenceId: occurrence.occurrenceId },
    });
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.snapshot.counts.deliveries <= 100)).toBe(
      true,
    );
    expect(
      runs.reduce((total, run) => total + run.snapshot.counts.deliveries, 0),
    ).toBe(150);
    expect(
      await persistence.receipts.count({
        parentId: occurrence.id,
        kind: "action",
        status: "committed",
      }),
    ).toBe(150);
    expect((await persistence.receipts.getById(occurrence.id)).status).toBe(
      "committed",
    );
  }, 60_000);
  it("does not expose an author's privileged source through a caller's metadata-read permission", async ({
    expect,
  }) => {
    const stored = await create();
    const quest = await createTestQuest(alepha, project, {
      title: "Protected source title",
    });
    const reader = await entities.users.create({ roles: ["user"] });
    await alepha.inject(RankService).save(
      project.organizationId!,
      {
        key: "preview-reader",
        name: "Preview reader",
        permissions: ["project:read", "automation:read"],
      },
      user,
    );
    await createTestMember(alepha, project, reader.id, {
      rank: "preview-reader",
    });
    const before = await state();
    await expect(
      evaluator.test(
        stored.id,
        { id: reader.id, roles: ["user"] },
        { kind: "subject", id: quest.id },
      ),
    ).rejects.toThrow("source access");
    expect(await state()).toBe(before);
  });
  it("reports email-less recipients and explicitly omitted output without writes", async ({
    expect,
  }) => {
    const quest = await createTestQuest(alepha, project);
    await entities.users.updateById(user.id, { email: null });
    const rule = ast();
    rule.actions = [
      { ...notify("A".repeat(10_000)), channel: "email" },
      ...Array.from({ length: 4 }, () => notify("B".repeat(10_000))),
    ];
    const stored = await create(rule);
    const before = await state();
    const report = await evaluator.test(stored.id, user, {
      kind: "subject",
      id: quest.id,
    });
    expect(report.status).toBe("preview");
    expect(report.operations[0]).toMatchObject({
      skipped: true,
      reason: "recipient_has_no_email",
    });
    expect(report.operationsOmitted).toBeGreaterThan(0);
    expect(report.counts.truncated).toBe(true);
    expect(await state()).toBe(before);
  });
  it("cancels ready occurrences after a disable or trigger edit without running the old program", async ({
    expect,
  }) => {
    for (const change of ["disable", "edit", "delete"] as const) {
      const stored = await create();
      const ready = await reserve(stored);
      if (change !== "delete")
        await persistence.rules.updateById(
          stored.id,
          change === "disable"
            ? { enabled: false }
            : {
                revision: 1,
                rule: {
                  ...stored.rule,
                  trigger: { kind: "schedule", cron: "*/5 * * * *" },
                  select: { kind: "scalar", key: "activeQuests", filters: {} },
                },
              },
        );
      if (change === "delete") await persistence.rules.deleteById(stored.id);
      await finish(ready.id);
      expect((await persistence.receipts.getById(ready.id)).status).toBe(
        "refused",
      );
      expect(
        await persistence.receipts.count({
          parentId: ready.id,
          kind: "action",
        }),
      ).toBe(0);
    }
  });
  it("reschedules bounded queue steps and resumes from frozen row data", async ({
    expect,
  }) => {
    const quests = [];
    for (let index = 0; index < 6; index++)
      quests.push(
        await createTestQuest(alepha, project, {
          tags: ["frozen"],
          title: `Original ${index}`,
        }),
      );
    const rule = ast();
    rule.trigger = { kind: "schedule", cron: "*/5 * * * *" };
    rule.select = {
      kind: "rows",
      key: "quests.open",
      filters: { tag: "frozen" },
    };
    const stored = await create(rule);
    const ready = await reserve(stored);
    await alepha.inject(AutomationClaims).sweepRecovery(1);
    let job = await rows.jobs.getOne({
      where: { jobName: alepha.inject(AutomationWorkerJobs).work.name },
    });
    const jobs = alepha.inject(JobProvider);
    await jobs.processExecution(job.jobName, job.id);
    job = await rows.jobs.getById(job.id);
    expect(job.status).toBe("scheduled");
    expect(
      await persistence.receipts.count({
        parentId: ready.id,
        kind: "action",
        status: "committed",
      }),
    ).toBe(5);
    await entities.quests.updateById(quests[5].id, {
      title: "Changed after evaluation",
    });
    await rows.jobs.updateById(job.id, { scheduledAt: time.nowISOString() });
    await jobs.processExecution(job.jobName, job.id);
    expect((await persistence.receipts.getById(ready.id)).status).toBe(
      "committed",
    );
    const notifications = await rows.jobs.findMany({
      where: { jobName: "system.notifications.send" },
    });
    expect(notifications).toHaveLength(6);
    expect(JSON.stringify(notifications.map((row) => row.payload))).toContain(
      "Original 5",
    );
    expect(
      JSON.stringify(notifications.map((row) => row.payload)),
    ).not.toContain("Changed after evaluation");
  });
  it("leaves broken-dependency and missing-variable refusals free of health mutations", async ({
    expect,
  }) => {
    const stored = await create();
    const quest = await createTestQuest(alepha, project);
    await entities.capabilities.deleteMany({
      projectId: project.id,
      key: "knowledge",
    });
    const rule = {
      ...stored.rule,
      actions: [
        {
          kind: "appendFolio" as const,
          folio: crypto.randomUUID(),
          text: "{{missing}}",
        },
      ],
    };
    await persistence.rules.updateById(stored.id, { rule });
    const before = await state();
    expect(
      (await evaluator.test(stored.id, user, { kind: "subject", id: quest.id }))
        .status,
    ).toBe("refused");
    expect(await state()).toBe(before);
    expect((await persistence.rules.getById(stored.id)).health).toBe("active");
  });
  it("refuses retired and foreign historical event snapshots without falling back to current subjects", async ({
    expect,
  }) => {
    const stored = await create();
    const retired = await persistence.events.create({
      projectId: project.id,
      identity: crypto.randomUUID(),
      name: "quest.completed",
      occurredAt: time.nowISOString(),
      replayUntil: time.now().add(90, "days").toISOString(),
      payload: { fields: {}, omitted: ["payload_retired"] },
    });
    const other = await createTestProject(alepha);
    const foreign = await persistence.events.create({
      projectId: other.id,
      identity: crypto.randomUUID(),
      name: "quest.completed",
      occurredAt: time.nowISOString(),
      replayUntil: time.now().add(90, "days").toISOString(),
      payload: { fields: { title: "Foreign secret" }, omitted: [] },
    });
    const before = await state();
    expect(
      (await evaluator.test(stored.id, user, { kind: "event", id: retired.id }))
        .reason,
    ).toContain("no longer retained");
    const refusal = await evaluator.test(stored.id, user, {
      kind: "event",
      id: foreign.id,
    });
    expect(refusal.status).toBe("refused");
    expect(JSON.stringify(refusal)).not.toContain("Foreign secret");
    expect(await state()).toBe(before);
  });
  it("queues durable recovery work and rotates global dispatcher priority with a shared 50-claim limit", async ({
    expect,
  }) => {
    const stored = await create();
    const occurrence = await reserve(stored);
    expect(await alepha.inject(AutomationClaims).sweepRecovery(1)).toBe(1);
    const job = await rows.jobs.getOne({
      where: { jobName: alepha.inject(AutomationWorkerJobs).work.name },
    });
    await alepha.inject(JobProvider).processExecution(job.jobName, job.id);
    expect((await persistence.receipts.getById(occurrence.id)).status).toBe(
      "committed",
    );
    const registry = new AutomationDispatchRegistry();
    const visited: string[] = [];
    for (const name of ["recovery", "events", "schedules"])
      registry.register(name, async (limit) => {
        visited.push(name);
        return limit;
      });
    for (let tick = 0; tick < 3; tick++)
      expect(await registry.tick(tick)).toBe(50);
    expect(visited).toEqual(["recovery", "events", "schedules"]);
  });
});
