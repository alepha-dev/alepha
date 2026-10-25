import { AutomationPersistence, AutomationRunEvidence } from "@lore/core/api";
import type { AutomationRule } from "@lore/core/schemas";
import { $hook, Alepha } from "alepha";
import { RankService } from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  TestEntityRepositories,
  createTestProject,
  createTestMember,
} from "./fixtures/entities.ts";

/**
 * Lands a second writer between a run read and its write, once.
 */
class RunRace {
  public next?: () => Promise<unknown>;
  protected readonly onRead = $hook({
    on: "repository:read:after",
    handler: async ({ tableName }) => {
      if (tableName !== "automation_runs" || !this.next) return;
      const run = this.next;
      this.next = undefined;
      await run();
    },
  });
}

describe("Bounded automation run evidence", () => {
  let alepha: Alepha;
  let entities: TestEntityRepositories;
  let evidence: AutomationRunEvidence;
  let persistence: AutomationPersistence;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  const config = (): AutomationRule => ({
    version: 1,
    trigger: { kind: "event", event: "feedback.created" },
    select: null,
    guard: null,
    actions: [
      {
        kind: "notify",
        recipient: user.id,
        channel: "inbox",
        title: "Feedback",
        text: "{{title}}",
        category: "automations",
      },
    ],
  });
  const create = async (rule = config()) =>
    persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Rule",
      rule,
    });
  const start = async (
    rule: Awaited<ReturnType<typeof create>>,
    planned: Array<{ index: number; row?: number }> = [],
  ) =>
    evidence.start({
      rule,
      occurrenceId: crypto.randomUUID(),
      triggeredAt: "2026-10-15T10:00:00.000Z",
      selected: [{ title: "One" }],
      matched: 1,
      planned,
    });
  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "error" },
    });
    bootLore(alepha, ["api"]);
    entities = alepha.inject(TestEntityRepositories);
    alepha.inject(RunRace);
    evidence = alepha.inject(AutomationRunEvidence);
    persistence = alepha.inject(AutomationPersistence);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [
        { key: "work", options: { automations: true } },
        { key: "support" },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("persists safe inputs, rule identity, evaluation time and pending plans before effects", async ({
    expect,
  }) => {
    const rule = await create();
    const run = await evidence.start({
      rule,
      occurrenceId: "event:one",
      triggeredAt: "2026-10-15T10:00:00.000Z",
      inputs: {
        title: "Safe",
        feedback_id: 12,
        credentials: "SECRET",
        reporter_email: "private@example.test",
        nested: { token: "secret" },
      },
      selected: [{ title: "Safe" }],
      matched: 1,
      total: 1,
      planned: [{ index: 0 }],
    });
    const stored = await persistence.runs.getById(run.id);
    expect(stored).toMatchObject({
      ruleRevision: 0,
      status: "queued",
      snapshot: {
        rule: rule.rule,
        inputs: { title: "Safe", feedback_id: 12 },
        counts: { selected: 1, matched: 1, executed: 0, totalIsExact: true },
        actions: [{ index: 0, status: "pending", result: {} }],
      },
    });
    expect(stored.snapshot.evaluatedAt).toBeDefined();
    expect(stored.snapshot.ruleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain("SECRET");
    expect(JSON.stringify(stored)).not.toContain("private@example.test");
  });

  it("caps selection at 50 and reports a lower bound instead of inventing an exact total", async ({
    expect,
  }) => {
    const rule = config();
    rule.trigger = { kind: "schedule", cron: "*/5 * * * *" };
    rule.select = { kind: "rows", key: "quests.open", filters: {} };
    const stored = await create(rule);
    const run = await evidence.start({
      rule: stored,
      occurrenceId: "schedule:one",
      triggeredAt: "2026-10-15T10:00:00.000Z",
      selected: Array.from({ length: 51 }, (_, index) => ({
        quest_id: index + 1,
        title: `Quest ${index + 1}`,
        raw_logs: "SECRET",
      })),
      matched: 50,
    });
    expect(run.snapshot.selected).toHaveLength(50);
    expect(run.snapshot.counts).toMatchObject({
      selected: 50,
      matched: 50,
      total: 51,
      totalIsExact: false,
      hasMore: true,
      truncated: true,
    });
    await expect(
      evidence.start({
        rule: stored,
        occurrenceId: "bad:total",
        triggeredAt: "2026-10-15T10:00:00.000Z",
        selected: [{ title: "One" }],
        hasMore: true,
        total: 1,
      }),
    ).rejects.toThrow("contradict");
    expect(JSON.stringify(run.snapshot)).not.toContain("SECRET");
  });

  it("records no_data and zero-match refusals without claiming successful effects", async ({
    expect,
  }) => {
    const rule = await create();
    const noData = await evidence.start({
      rule,
      occurrenceId: "metric:no-data",
      triggeredAt: "2026-10-15T10:00:00.000Z",
      status: "skipped",
      reason: "no_data",
    });
    expect(noData).toMatchObject({
      status: "skipped",
      reason: "no_data",
      snapshot: { counts: { executed: 0, matched: 0 } },
    });
    expect(noData.finishedAt).toBeDefined();
    expect(await evidence.finish(noData.id)).toMatchObject({
      status: "skipped",
    });
    const empty = await start(rule);
    expect(await evidence.finish(empty.id)).toMatchObject({
      status: "skipped",
      snapshot: { counts: { executed: 0 } },
    });
  });

  it("links enqueues to receipts, stops on failure and preserves truthful partial counts", async ({
    expect,
  }) => {
    const rule = config();
    rule.actions = [rule.actions[0], rule.actions[0], rule.actions[0]];
    const run = await start(await create(rule), [
      { index: 0 },
      { index: 1 },
      { index: 2 },
    ]);
    const receiptId = crypto.randomUUID();
    const committed = await evidence.action(run.id, {
      index: 0,
      status: "queued",
      receiptId,
      deliveries: 1,
      result: { outbox_id: "outbox-1", delivered: true, credentials: "SECRET" },
    });
    expect(committed.snapshot.actions[0]).toMatchObject({
      status: "queued",
      receiptId,
      result: { outbox_id: "outbox-1", enqueued: true, delivered: false },
    });
    await evidence.action(run.id, {
      index: 0,
      status: "queued",
      receiptId,
      deliveries: 1,
    });
    await evidence.action(run.id, {
      index: 1,
      status: "failed",
      result: { reason: "Known refusal" },
    });
    const finished = await evidence.finish(run.id, "Second action failed");
    expect(finished).toMatchObject({
      status: "partial",
      snapshot: { counts: { executed: 1, deliveries: 1 } },
    });
    expect(finished.snapshot.actions[2].status).toBe("skipped");
    expect(JSON.stringify(finished)).not.toContain("SECRET");
    await expect(
      evidence.action(run.id, { index: 2, status: "running" }),
    ).rejects.toThrow("terminal");
  });

  it("refuses delivery overflow and pauses uncertain external outcomes without blind replay", async ({
    expect,
  }) => {
    const rule = await create();
    const run = await start(rule, [{ index: 0 }]);
    await expect(
      evidence.action(run.id, { index: 0, status: "queued", deliveries: 101 }),
    ).rejects.toThrow("100");
    await evidence.action(run.id, {
      index: 0,
      status: "unknown",
      receiptId: crypto.randomUUID(),
    });
    expect(await evidence.finish(run.id)).toMatchObject({
      status: "unknown",
      snapshot: { counts: { executed: 0, deliveries: 0 } },
    });
    expect(await persistence.rules.getById(rule.id)).toMatchObject({
      health: "paused",
      requiresApproval: true,
      enabled: false,
    });
  });

  it("refuses oversized UTF-8 evidence before effects while retaining an honest rule hash", async ({
    expect,
  }) => {
    const configValue = config();
    configValue.actions = [
      {
        kind: "notify",
        recipient: user.id,
        channel: "inbox",
        title: "x",
        text: "{{body}} {{extra}} {{third}}",
        category: "automations",
      },
    ];
    const rule = await create(configValue);
    const run = await evidence.start({
      rule,
      occurrenceId: "event:large",
      triggeredAt: "2026-10-15T10:00:00.000Z",
      selected: [{ title: "One" }],
      matched: 1,
      variables: ["body", "extra", "third"].map((key) => ({
        key,
        version: 0,
        value: { kind: "text", value: "😀".repeat(6_000) },
      })),
      planned: [{ index: 0 }],
    });
    expect(run).toMatchObject({
      status: "refused",
      snapshot: { rule: null, actions: [], counts: { executed: 0 } },
    });
    expect(run.snapshot.omitted).toContain("before effects");
    expect(run.snapshot.ruleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      new TextEncoder().encode(JSON.stringify(run.snapshot)).byteLength,
    ).toBeLessThanOrEqual(65_536);
    await expect(
      evidence.action(run.id, { index: 0, status: "running" }),
    ).rejects.toThrow("terminal");
  });

  it("records one health transition per change and keeps enable intent separate", async ({
    expect,
  }) => {
    const rule = await create();
    expect(
      await evidence.transition(rule.id, "paused", "Author lost access", true),
    ).toBe(true);
    expect(
      await evidence.transition(rule.id, "paused", "Author lost access", true),
    ).toBe(false);
    expect(await persistence.runs.count({ automationId: rule.id })).toBe(1);
    expect(await evidence.transition(rule.id, "active", undefined, false)).toBe(
      true,
    );
    expect(await persistence.runs.count({ automationId: rule.id })).toBe(2);
    expect(await persistence.rules.getById(rule.id)).toMatchObject({
      enabled: false,
      health: "active",
    });
  });

  it("redacts evidence according to the reader's current source access", async ({
    expect,
  }) => {
    const rule = await create();
    const run = await evidence.start({
      rule,
      occurrenceId: "event:private",
      triggeredAt: "2026-10-15T10:00:00.000Z",
      inputs: { title: "Private feedback" },
    });
    const reader = await entities.users.create({ roles: ["user"] });
    await alepha.inject(RankService).save(
      project.organizationId!,
      {
        key: "automation-reader",
        name: "Reader",
        permissions: ["project:read", "automation:read"],
      },
      user,
    );
    await createTestMember(alepha, project, reader.id, {
      rank: "automation-reader",
    });
    const redacted = await evidence.read(run.id, {
      id: reader.id,
      roles: ["user"],
    });
    expect(redacted).toMatchObject({ redacted: true, snapshot: null });
    expect(JSON.stringify(redacted)).not.toContain("Private feedback");
    expect((await evidence.read(run.id, user)).snapshot?.inputs).toEqual({
      title: "Private feedback",
    });
  });

  it("writes run evidence by compare-and-set and never over a concurrent write", async ({
    expect,
  }) => {
    const rule = await create();
    const run = await start(rule, [{ index: 0 }]);
    const stale = await persistence.runs.getById(run.id);
    await persistence.runs.updateById(run.id, { reason: "Moved" });
    expect(await evidence.swap(stale, { reason: "Stale" })).toBeUndefined();
    expect((await persistence.runs.getById(run.id)).reason).toBe("Moved");
    // A writer landing between the action's read and its write: the retry
    // rereads the run, so the concurrent flag survives the action's write.
    alepha.inject(RunRace).next = async () => {
      const fresh = await persistence.runs.getById(run.id);
      await persistence.runs.updateById(run.id, {
        snapshot: {
          ...fresh.snapshot,
          counts: { ...fresh.snapshot.counts, truncated: true },
        },
      });
    };
    const written = await evidence.action(run.id, {
      index: 0,
      status: "running",
    });
    expect(written.snapshot.counts.truncated).toBe(true);
    expect(written.snapshot.actions[0].status).toBe("running");
    expect(alepha.inject(RunRace).next).toBeUndefined();
  });
  it("prunes old terminal details in bounded pages while preserving live work and configuration", async ({
    expect,
  }) => {
    const rule = await create();
    const template = await start(rule);
    const old = alepha
      .inject(DateTimeProvider)
      .now()
      .subtract(31, "days")
      .toISOString();
    await persistence.runs.createMany(
      Array.from({ length: 105 }, () => ({
        projectId: project.id,
        automationId: rule.id,
        ruleRevision: 0,
        occurrenceId: crypto.randomUUID(),
        triggeredAt: old,
        status: "succeeded" as const,
        snapshot: template.snapshot,
        createdAt: old,
        finishedAt: old,
      })),
    );
    const live = await persistence.runs.create({
      projectId: project.id,
      automationId: rule.id,
      ruleRevision: 0,
      occurrenceId: "live:old",
      triggeredAt: old,
      status: "running",
      snapshot: template.snapshot,
      createdAt: old,
      finishedAt: old,
    });
    // Two pages of 50: the page cap bounds one call, the next call resumes.
    expect(await evidence.prune(2)).toBe(100);
    expect(await persistence.runs.count()).toBe(7);
    expect(await persistence.runs.getById(live.id)).toMatchObject({
      status: "running",
    });
    expect(await persistence.rules.getById(rule.id)).toBeDefined();
    expect(await evidence.prune()).toBe(5);
    expect(await evidence.prune()).toBe(0);
  });
  it("keeps paging in one daily call until a page comes back short", async ({
    expect,
  }) => {
    const rule = await create();
    const template = await start(rule);
    const old = alepha
      .inject(DateTimeProvider)
      .now()
      .subtract(31, "days")
      .toISOString();
    await persistence.runs.createMany(
      Array.from({ length: 230 }, () => ({
        projectId: project.id,
        automationId: rule.id,
        ruleRevision: 0,
        occurrenceId: crypto.randomUUID(),
        triggeredAt: old,
        status: "succeeded" as const,
        snapshot: template.snapshot,
        createdAt: old,
        finishedAt: old,
      })),
    );
    expect(await evidence.prune()).toBe(230);
    expect(await persistence.runs.count()).toBe(1);
  });
});
