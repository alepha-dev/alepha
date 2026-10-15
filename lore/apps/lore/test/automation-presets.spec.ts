import {
  AutomationClaims,
  AutomationController,
  AutomationEvents,
  AutomationPersistence,
  AutomationPresetRegistry,
  AutomationService,
  AutomationSchedules,
  AutomationWorker,
} from "@lore/core/api";
import { AutomationPresetForms } from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import {
  FeedbackController,
  QuestController,
  EpicWorkflowService,
} from "@lore/work/api";
import { Alepha, AlephaError } from "alepha";
import { JobQueueProvider, jobExecutionEntity } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
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

class PresetQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class PresetRows {
  public readonly jobs = $repository(jobExecutionEntity);
}

describe("Stock automation presets", () => {
  let alepha: Alepha;
  let persistence: AutomationPersistence;
  let entities: TestEntityRepositories;
  let rows: PresetRows;
  let api: AutomationController;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  let time: DateTimeProvider;
  const create = async (key: string, values: Record<string, string> = {}) =>
    (
      await api.createAutomationFromPreset.fetch(
        {
          params: { projectId: project.id },
          body: { key, values: { recipient: user.id, ...values } },
        },
        { user },
      )
    ).data;
  const arm = async (key: string, values: Record<string, string> = {}) => {
    const rule = await create(key, values);
    return alepha
      .inject(AutomationService)
      .setEnabled(project.id, rule.id, user, true, rule.revision);
  };
  const finish = async (id: string) => {
    let next: { receiptId: string; token?: string } | undefined = {
      receiptId: id,
    };
    for (let index = 0; next && index < 20; index++)
      next = await alepha.inject(AutomationWorker).step(next, 3);
    if (next) throw new AlephaError("Preset worker exceeded its step budget");
  };
  const dispatch = async (id: string) => {
    const ready = await persistence.receipts.findMany({
      where: { automationId: id, kind: "occurrence", status: "ready" },
    });
    for (const receipt of ready) await finish(receipt.id);
    return ready;
  };
  const notifications = () =>
    rows.jobs.findMany({ where: { jobName: "system.notifications.send" } });
  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: PresetQueue });
    bootLore(alepha);
    entities = alepha.inject(TestEntityRepositories);
    rows = alepha.inject(PresetRows);
    api = alepha.inject(AutomationController);
    persistence = alepha.inject(AutomationPersistence);
    time = alepha.inject(DateTimeProvider);
    await alepha.start();
    time.pause();
    project = await createTestProject(alepha, {
      capabilities: [
        { key: "work", options: { automations: true, epics: true } },
        { key: "support" },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("publishes typed setup, context, inbox defaults and independent literal recipients", async ({
    expect,
  }) => {
    const catalog = (
      await api.getAutomationCatalog.fetch(
        { params: { projectId: project.id } },
        { user },
      )
    ).data;
    expect(catalog.presets.map((preset) => preset.key)).toEqual([
      "feedback-created",
      "tagged-quest-digest",
      "epic-completed",
    ]);
    const preset = catalog.presets.find(
      (entry) => entry.key === "tagged-quest-digest",
    )!;
    expect(preset).toMatchObject({
      available: true,
      schedule: "0 0 * * *",
      slots: {
        recipient: { kind: "member", required: true },
        channel: { default: "inbox", values: ["inbox", "email"] },
        tag: { kind: "text", required: true },
      },
      fields: { summary: "text", tag: "text", truncated: "boolean" },
    });
    const forms = new AutomationPresetForms();
    expect(forms.defaults(preset)).toEqual({ channel: "inbox" });
    expect(
      forms
        .schema(preset)
        .safeParse({ recipient: user.id, channel: "inbox", tag: "daily" })
        .success,
    ).toBe(true);
    expect(
      forms
        .schema(preset)
        .safeParse({ recipient: "{{recipient}}", channel: "inbox", tag: "" })
        .success,
    ).toBe(false);
    const inbox = await create("feedback-created");
    const email = await create("feedback-created", { channel: "email" });
    expect(inbox).toMatchObject({
      enabled: false,
      presetKey: "feedback-created",
      rule: { actions: [{ recipient: user.id, channel: "inbox" }] },
    });
    expect(email.rule!.actions[0]).toMatchObject({ channel: "email" });
    expect(await persistence.variables.count({ projectId: project.id })).toBe(
      0,
    );
    await expect(
      create("tagged-quest-digest", { tag: "{{shared_tag}}" }),
    ).rejects.toThrow("literal value");
    await expect(
      create("feedback-created", { unrecognized: "x" }),
    ).rejects.toThrow("setup.unrecognized");
    expect(alepha.inject(AutomationPresetRegistry).all()).toHaveLength(3);
  });
  it("refuses unavailable capabilities and foreign recipients before creating a program", async ({
    expect,
  }) => {
    const outsider = await entities.users.create({ roles: ["user"] });
    await expect(
      create("feedback-created", { recipient: outsider.id }),
    ).rejects.toThrow("actions[0].recipient");
    await entities.capabilities.deleteMany({
      projectId: project.id,
      key: "support",
    });
    const catalog = (
      await api.getAutomationCatalog.fetch(
        { params: { projectId: project.id } },
        { user },
      )
    ).data;
    expect(
      catalog.presets.find((preset) => preset.key === "feedback-created"),
    ).toMatchObject({
      available: false,
      reason: "Missing feedback:read",
    });
    await expect(create("feedback-created")).rejects.toThrow(
      "support capability",
    );
    expect(await persistence.rules.count({ projectId: project.id })).toBe(0);
  });
  it("enqueues one sanitized feedback alert per actual same-project event", async ({
    expect,
  }) => {
    await entities.users.updateById(user.id, { email: "private@example.test" });
    const rule = await arm("feedback-created");
    const other = await createTestProject(alepha, {
      capabilities: [{ key: "support" }],
    });
    await entities.users.updateById(other.createdBy, { roles: ["user"] });
    await alepha.inject(FeedbackController).submitFeedback.fetch(
      {
        params: { projectId: other.id },
        body: { title: "Other project", description: "Other" },
      },
      { user: { id: other.createdBy, roles: ["user"] } },
    );
    await alepha.inject(FeedbackController).submitFeedback.fetch(
      {
        params: { projectId: project.id },
        body: { title: "A <safe> title", description: "PRIVATE REPORT BODY" },
      },
      { user },
    );
    await alepha.inject(AutomationEvents).sweep(50);
    const ready = await dispatch(rule.id);
    expect(ready).toHaveLength(1);
    expect(await alepha.inject(AutomationEvents).sweep(50)).toBe(0);
    await finish(ready[0].id);
    const jobs = await notifications();
    expect(jobs).toHaveLength(1);
    const payload = JSON.stringify(jobs[0].payload!.variables);
    expect(payload).toContain("A <safe> title");
    expect(payload).not.toContain("PRIVATE REPORT BODY");
    expect(payload).not.toContain("private@example.test");
    expect(payload).not.toContain("Other project");
    expect(jobs[0].payload).toMatchObject({ type: "inbox", lang: "en" });
  });
  it("runs one midnight digest with held work and truthful 50-row truncation", async ({
    expect,
  }) => {
    const draft = await createTestEpic(alepha, project);
    await createTestQuest(alepha, project, {
      epicId: draft.id,
      tags: ["daily"],
      title: "Hidden draft",
    });
    await createTestQuest(alepha, project, {
      completedAt: time.nowISOString(),
      tags: ["daily"],
      title: "Hidden completed",
    });
    await createTestQuest(alepha, project, {
      shelvedAt: time.nowISOString(),
      tags: ["daily"],
      title: "Hidden shelved",
    });
    const visible = [];
    for (let index = 0; index < 51; index++)
      visible.push(
        await createTestQuest(alepha, project, {
          title: `Visible ${index}`,
          tags: ["daily"],
          ...(index === 0 ? { heldAt: time.nowISOString() } : {}),
        }),
      );
    const rule = await arm("tagged-quest-digest", { tag: "daily" });
    const stored = await persistence.rules.getById(rule.id);
    expect(stored.scheduleCron).toBe("0 0 * * *");
    expect(stored.nextRunAt!.slice(11)).toBe("00:00:00.000Z");
    await time.travel(new Date(stored.nextRunAt!).getTime() - time.nowMillis());
    expect(await alepha.inject(AutomationSchedules).sweep()).toBe(1);
    const dispatched = await dispatch(rule.id);
    const digestReceipt = await persistence.receipts.getById(dispatched[0].id);
    expect(digestReceipt.reason).toBeUndefined();
    expect(digestReceipt.status).toBe("committed");
    const jobs = await notifications();
    const run = await persistence.runs.getOne({
      where: { automationId: rule.id, occurrenceId: { notLike: "health:%" } },
    });
    expect(run.status).toBe("succeeded");
    expect(run.reason).toBeUndefined();
    expect(jobs).toHaveLength(1);
    expect(run.snapshot.counts).toMatchObject({
      selected: 50,
      truncated: true,
      deliveries: 1,
    });
    expect(run.snapshot.selected.map((item) => item.shortId)).toEqual(
      visible.slice(0, 50).map((quest) => quest.shortId),
    );
    expect(run.snapshot.selected[0]).toMatchObject({ status: "on_hold" });
    const payload = JSON.stringify(jobs[0].payload);
    expect(payload).toContain("Visible 0");
    expect(payload).not.toContain("Hidden");
    expect(payload).not.toContain("Visible 50");
    const missingContext = await alepha
      .inject(AutomationService)
      .create(project.id, user, {
        title: "Truncated refusal",
        rule: {
          ...rule.rule!,
          actions: [
            { ...rule.rule!.actions[0], text: "{{url}}" } as NonNullable<
              typeof rule.rule
            >["actions"][number],
          ],
        },
      });
    const beforePreview = await persistence.runs.count();
    const preview = await alepha
      .inject(AutomationService)
      .test(project.id, missingContext.id, user);
    expect(preview).toMatchObject({
      status: "refused",
      reason: expect.stringContaining("url"),
    });
    expect(await persistence.runs.count()).toBe(beforePreview);
  });
  it("does not enqueue an empty collection", async ({ expect }) => {
    const rule = await arm("tagged-quest-digest", { tag: "empty" });
    const ready = await alepha.inject(AutomationClaims).reserve({
      automationId: rule.id,
      revision: rule.revision,
      source: { kind: "schedule", scheduledAt: time.nowISOString() },
    });
    await finish(ready.id);
    expect(await notifications()).toHaveLength(0);
    const run = await persistence.runs.getOne({
      where: { automationId: rule.id, occurrenceId: { notLike: "health:%" } },
    });
    expect(run).toMatchObject({
      status: "skipped",
      snapshot: { counts: { selected: 0, deliveries: 0 } },
    });
  });
  it("announces actual automatic epic completion, never a ready all-shelved epic", async ({
    expect,
  }) => {
    const rule = await arm("epic-completed");
    const epic = await createTestEpic(alepha, project, {
      status: "in_progress",
      title: "Delivery epic",
    });
    const quest = await createTestQuest(alepha, project, {
      epicId: epic.id,
      acceptedAt: time.nowISOString(),
      acceptedBy: user.id,
    });
    await alepha
      .inject(QuestController)
      .completeQuest.fetch({ params: { id: quest.id }, body: {} }, { user });
    await alepha.inject(EpicWorkflowService).completeIfResolved(quest, user);
    const readyEpic = await createTestEpic(alepha, project, {
      status: "ready",
    });
    const shelved = await createTestQuest(alepha, project, {
      epicId: readyEpic.id,
      shelvedAt: time.nowISOString(),
    });
    await alepha.inject(EpicWorkflowService).completeIfResolved(shelved, user);
    await alepha.inject(AutomationEvents).sweep(50);
    await dispatch(rule.id);
    expect(await notifications()).toHaveLength(1);
    const payload = JSON.stringify((await notifications())[0].payload);
    expect(payload).toContain("Epic completed: Delivery epic");
    expect(payload).toContain("completed. Quests: 1.");
    expect(payload).not.toContain("ready to conclude");
    expect((await entities.epics.getById(readyEpic.id)).status).toBe("ready");
  });
});
