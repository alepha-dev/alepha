import {
  AutomationClaims,
  AutomationEvaluator,
  AutomationPersistence,
  AutomationWorker,
} from "@lore/core/api";
import { automationLine, type AutomationLineSpec } from "@lore/core/testing";
import { Alepha, AlephaError } from "alepha";
import { JobQueueProvider } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestFolio,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

type EventName = Parameters<
  AutomationPersistence["events"]["create"]
>[0]["name"];

class HeldQueue extends JobQueueProvider {
  public override async dispatch() {}
}

/**
 * Node outputs (#Q3814): an action's result reaches the actions after it,
 * as flat names a template binds like a field.
 */
describe("Automation node outputs", () => {
  let alepha: Alepha;
  let persistence: AutomationPersistence;
  let entities: TestEntityRepositories;
  let time: DateTimeProvider;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;

  const create = async (rule: AutomationLineSpec) => {
    const row = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Rule",
      rule: automationLine(rule),
    });
    return persistence.rules.updateById(row.id, { enabled: true });
  };
  const reserve = async (
    rule: Awaited<ReturnType<typeof create>>,
    fields: Record<string, string | number | boolean | null> = {},
  ) => {
    const source = rule.rule.nodes.find((node) => node.kind === "source")!;
    const event =
      source.type !== "schedule"
        ? await persistence.events.create({
            projectId: project.id,
            identity: crypto.randomUUID(),
            name: source.type as EventName,
            occurredAt: time.nowISOString(),
            replayUntil: time.now().add(90, "days").toISOString(),
            payload: { fields, omitted: [] },
          })
        : undefined;
    return alepha.inject(AutomationClaims).reserve({
      automationId: rule.id,
      revision: rule.revision,
      source: event
        ? { kind: "event", eventId: event.id, node: "source" }
        : { kind: "schedule", scheduledAt: time.nowISOString() },
    });
  };
  const finish = async (id: string) => {
    let next: { receiptId: string; token?: string } | undefined = {
      receiptId: id,
    };
    for (let step = 0; next && step < 80; step++)
      next = await alepha.inject(AutomationWorker).step(next, 3);
    if (next) throw new AlephaError("Worker exceeded the test's bounded steps");
  };
  const followUps = (release: number): AutomationLineSpec => ({
    trigger: { kind: "schedule", cron: "0 9 * * *" },
    select: { kind: "rows", key: "quests.open", filters: { tag: "triage" } },
    guard: null,
    actions: [
      {
        kind: "createQuest",
        title: "Follow up {{title}}",
        description: "From #{{shortId}}",
        area: "ops",
      },
      { kind: "addTag", quest: "{{created_quest_id}}", tag: "follow-up" },
      {
        kind: "assignRelease",
        quest: "{{created_quest_id}}",
        release,
      },
    ],
  });

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: HeldQueue });
    bootLore(alepha);
    persistence = alepha.inject(AutomationPersistence);
    entities = alepha.inject(TestEntityRepositories);
    time = alepha.inject(DateTimeProvider);
    await alepha.start();
    time.pause();
    project = await createTestProject(alepha, {
      capabilities: [
        { key: "plan", options: { releases: true, feedback: true } },
        { key: "remember" },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("creates a quest per row, then tags it and assigns it to a release", async ({
    expect,
  }) => {
    const release = await entities.releases.create({
      projectId: project.id,
      number: 1,
      tag: "1.0.0",
      title: "One",
      description: "",
    });
    // High numbers: the fixture does not draw from the sequence a real
    // quest takes its number from.
    const first = await createTestQuest(alepha, project, {
      title: "Crash",
      area: "ops",
      shortId: 1001,
    });
    const second = await createTestQuest(alepha, project, {
      title: "Typo",
      area: "ops",
      shortId: 1002,
    });
    for (const quest of [first, second])
      await entities.quests.updateById(quest.id, { tags: ["triage"] });
    const rule = await create(followUps(release.id));
    const occurrence = await reserve(rule);
    await finish(occurrence.id);

    const created = await entities.quests.findMany({
      where: { projectId: project.id, title: { like: "Follow up %" } },
    });
    expect(created.map((quest) => quest.title).sort()).toEqual([
      "Follow up Crash",
      "Follow up Typo",
    ]);
    for (const quest of created) {
      expect(quest.tags).toEqual(["follow-up"]);
      expect(quest.releaseId).toBe(release.id);
    }
    const [run] = await persistence.runs.findMany({
      where: { automationId: rule.id },
    });
    expect(run.status).toBe("succeeded");
    expect(run.snapshot.actions.map((step) => [step.node, step.row])).toEqual([
      ["action-1", 0],
      ["action-2", 0],
      ["action-3", 0],
      ["action-1", 1],
      ["action-2", 1],
      ["action-3", 1],
    ]);
    // Each row's tag went to the quest that row created.
    const tags = await persistence.receipts.findMany({
      where: { automationId: rule.id, kind: "action", nodeId: "action-2" },
    });
    const creates = await persistence.receipts.findMany({
      where: { automationId: rule.id, kind: "action", nodeId: "action-1" },
    });
    for (const tag of tags)
      expect(tag.result?.quest_id).toBe(
        creates.find((row) => row.rowIndex === tag.rowIndex)?.result?.quest_id,
      );
  });

  it("skips the steps that name the output of a producer that changed nothing", async ({
    expect,
  }) => {
    const folio = await createTestFolio(alepha, project, { content: "Log" });
    const rule = await create({
      trigger: { kind: "event", event: "feedback.created" },
      select: null,
      guard: null,
      actions: [
        // An empty description appends nothing: the folio is unchanged.
        { kind: "appendFolio", folio: folio.id, text: "{{description}}" },
        {
          kind: "createQuest",
          title: "Logged in {{appended_folio_id}}",
          description: "",
          area: "ops",
        },
      ],
    });
    const occurrence = await reserve(rule, {
      title: "Quiet",
      description: "",
      feedback_id: 1,
      shortId: 1,
    });
    await finish(occurrence.id);
    expect(await entities.quests.count({ projectId: project.id })).toBe(0);
    const [run] = await persistence.runs.findMany({
      where: { automationId: rule.id },
    });
    expect(run.snapshot.actions).toMatchObject([
      { node: "action-1", status: "skipped" },
      {
        node: "action-2",
        status: "skipped",
        result: {
          reason: "Output unavailable: appended_folio_id (from action-1)",
        },
      },
    ]);
    expect((await persistence.receipts.getById(occurrence.id)).status).toBe(
      "committed",
    );
  });

  it("tests a rule whose slots name an output without writing, and says they are not validated", async ({
    expect,
  }) => {
    const release = await entities.releases.create({
      projectId: project.id,
      number: 1,
      tag: "1.0.0",
      title: "One",
      description: "",
    });
    const quest = await createTestQuest(alepha, project, {
      title: "Crash",
      area: "ops",
    });
    await entities.quests.updateById(quest.id, { tags: ["triage"] });
    const rule = await create(followUps(release.id));
    const before = await entities.quests.count({ projectId: project.id });
    const report = await alepha.inject(AutomationEvaluator).test(rule.id, user);
    expect(report.status).toBe("preview");
    expect(report.operations).toMatchObject([
      { node: "action-1", row: 0, rendered: { title: "Follow up Crash" } },
      {
        node: "action-2",
        row: 0,
        unvalidated: ["quest"],
        reason: "Known only when the run is real: created_quest_id",
        rendered: { quest: "{{created_quest_id}}", tag: "follow-up" },
      },
      { node: "action-3", row: 0, unvalidated: ["quest"] },
    ]);
    expect(await entities.quests.count({ projectId: project.id })).toBe(before);
    expect(await persistence.receipts.count({ automationId: rule.id })).toBe(0);
  });

  it("refuses an output no action before it produces", async ({ expect }) => {
    const rule = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Rule",
      rule: automationLine({
        trigger: { kind: "event", event: "feedback.created" },
        select: null,
        guard: null,
        actions: [{ kind: "addTag", quest: "{{created_quest_id}}", tag: "x" }],
      }),
    });
    const report = await alepha
      .inject(AutomationEvaluator)
      .test(rule.id, user, {
        kind: "event",
        id: (
          await persistence.events.create({
            projectId: project.id,
            identity: crypto.randomUUID(),
            name: "feedback.created",
            occurredAt: time.nowISOString(),
            replayUntil: time.now().add(90, "days").toISOString(),
            payload: { fields: { title: "x" }, omitted: [] },
          })
        ).id,
      });
    expect(report.status).toBe("refused");
    expect(report.reason).toContain("created_quest_id");
  });
});
