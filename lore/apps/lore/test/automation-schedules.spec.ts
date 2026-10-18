import {
  AutomationCatalog,
  AutomationClaims,
  AutomationPersistence,
  AutomationRunEvidence,
  AutomationSchedules,
  AutomationSelections,
  AutomationTemplateRenderer,
  AutomationVariables,
} from "@lore/core/api";
import { AutomationCron, type AutomationRule } from "@lore/core/schemas";
import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { DatabaseProvider, sql } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { ConflictError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  TestEntityRepositories,
  createTestProject,
  createTestQuest,
  createTestEpic,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

/**
 * Moves a rule's schedule cursor between the sweep's page read and its
 * reservation: the guard of that one reservation no longer holds.
 */
class CursorRace {
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly time = $inject(DateTimeProvider);
  public armed = false;
  public moved?: string;
  protected readonly onRead = $hook({
    on: "repository:read:after",
    handler: async ({ tableName, entities }) => {
      if (!this.armed || tableName !== "automations" || entities.length !== 1)
        return;
      this.armed = false;
      this.moved = entities[0].id;
      await this.persistence.rules.updateById(entities[0].id, {
        nextRunAt: this.time.now().subtract(1, "days").toISOString(),
      });
    },
  });
}

describe("Automation schedules and named selections", () => {
  let alepha: Alepha;
  let persistence: AutomationPersistence;
  let entities: TestEntityRepositories;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  let time: DateTimeProvider;
  let cron: AutomationCron;
  const config = (
    kind: "rows" | "scalar" | "collection" = "rows",
    key = "quests.open",
  ): AutomationRule => ({
    version: 1,
    trigger: { kind: "schedule", cron: "*/5 * * * *" },
    select: {
      kind,
      key,
      filters: key === "quests.tagged" ? { tag: "daily" } : {},
    },
    guard: null,
    actions: [
      {
        kind: "notify",
        recipient: user.id,
        channel: "inbox",
        title: "Scheduled",
        text:
          kind === "collection"
            ? "{{summary}}"
            : kind === "scalar"
              ? "{{value}}"
              : "{{title}}",
        category: "automations",
      },
    ],
  });
  const rule = async (ast = config(), enabled = false) => {
    const compiled = await alepha
      .inject(AutomationCatalog)
      .compile(project.id, user, ast);
    const created = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Schedule",
      rule: ast,
      scheduleCron: compiled.scheduleCron,
    });
    return enabled
      ? persistence.rules.updateById(created.id, {
          enabled: true,
          nextRunAt: time.now().subtract(2, "days").toISOString(),
        })
      : created;
  };
  const evaluate = (
    row: Awaited<ReturnType<typeof rule>>,
    cursor?: Parameters<AutomationSelections["evaluate"]>[0]["cursor"],
  ) =>
    alepha.inject(AutomationSelections).evaluate({
      rule: row,
      user,
      variables: [],
      ...(cursor ? { cursor } : {}),
    });
  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    });
    alepha.with({ provide: CronProvider, use: ManualCronProvider });
    bootLore(alepha);
    entities = alepha.inject(TestEntityRepositories);
    persistence = alepha.inject(AutomationPersistence);
    alepha.inject(CursorRace);
    time = alepha.inject(DateTimeProvider);
    cron = alepha.inject(AutomationCron);
    await alepha.start();
    time.pause();
    project = await createTestProject(alepha, {
      capabilities: [
        {
          key: "work",
          options: { automations: true, reminder: true, epics: true },
        },
        { key: "support" },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] } as UserAccountToken;
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("coalesces missed ticks with one atomic cursor move and one durable ready occurrence", async ({
    expect,
  }) => {
    const emitted = alepha
      .inject(CronProvider)
      .getCronJobs()
      .filter((job) => job.name.includes("automations.dispatch"));
    expect(emitted).toHaveLength(1);
    expect(emitted[0].expression).toBe("*/5 * * * *");
    const row = await rule(config(), true);
    const schedules = alepha.inject(AutomationSchedules);
    expect(await schedules.sweepDetailed()).toMatchObject({
      claimed: 1,
      scanned: 1,
      hasMore: false,
    });
    expect(await schedules.sweep()).toBe(0);
    const receipt = await persistence.receipts.getOne({
      where: { automationId: row.id, kind: "occurrence" },
    });
    expect(receipt).toMatchObject({
      status: "ready",
      occurrenceId: `schedule:${cron.latest("*/5 * * * *", time.nowISOString())}`,
      ruleRevision: row.revision,
    });
    expect((await persistence.rules.getById(row.id)).nextRunAt).toBe(
      cron.next("*/5 * * * *", time.nowISOString()),
    );
    expect(await persistence.runs.count({ automationId: row.id })).toBe(0);
  });
  it("skips the one rule whose reservation guard stopped holding and claims the rest", async ({
    expect,
  }) => {
    const first = await rule(config(), true);
    const second = await rule(config(), true);
    const race = alepha.inject(CursorRace);
    race.armed = true;
    const schedules = alepha.inject(AutomationSchedules);
    expect(await schedules.sweepDetailed()).toMatchObject({
      claimed: 1,
      scanned: 2,
    });
    expect(race.moved).toBeDefined();
    const other = race.moved === first.id ? second.id : first.id;
    expect(
      await persistence.receipts.count({
        automationId: race.moved!,
        kind: "occurrence",
      }),
    ).toBe(0);
    expect(
      await persistence.receipts.count({
        automationId: other,
        kind: "occurrence",
      }),
    ).toBe(1);
    // The skipped rule is still due, and the next tick reserves it.
    expect(await schedules.sweep()).toBe(1);
  });
  it("keeps a transient reservation failure distinct from a guard that no longer holds", async ({
    expect,
  }) => {
    const row = await rule(config(), true);
    const claims = alepha.inject(AutomationClaims);
    const refused = await claims
      .reserve({
        automationId: row.id,
        revision: row.revision,
        source: { kind: "schedule", scheduledAt: time.nowISOString() },
        condition: sql`1 = 0`,
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(refused).toBeInstanceOf(ConflictError);
    const failed = await claims
      .reserve({
        automationId: row.id,
        revision: row.revision,
        source: { kind: "schedule", scheduledAt: time.nowISOString() },
        mutation: sql`INSERT INTO automation_missing_table (id) VALUES (1)`,
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(failed).toBeInstanceOf(Error);
    expect(failed).not.toBeInstanceOf(ConflictError);
    expect(await persistence.receipts.count({ automationId: row.id })).toBe(0);
  });
  it("uses fair indexed 50-rule pages across simultaneous sweeps and prevents overlap", async ({
    expect,
  }) => {
    for (let index = 0; index < 52; index += 1) await rule(config(), true);
    const schedules = alepha.inject(AutomationSchedules);
    const results = await Promise.all([schedules.sweep(), schedules.sweep()]);
    expect(results.every((count) => count <= 50)).toBe(true);
    const reserved = await persistence.receipts.count({
      kind: "occurrence",
      status: "ready",
    });
    expect(reserved).toBeGreaterThanOrEqual(50);
    expect(reserved).toBeLessThanOrEqual(52);
    expect(await schedules.sweep()).toBe(52 - reserved);
    const [first] = await persistence.receipts.findMany({
      where: { kind: "occurrence" },
      orderBy: "id",
      limit: 1,
    });
    await persistence.rules.updateById(first.automationId!, {
      nextRunAt: time.now().subtract(1, "hour").toISOString(),
    });
    expect(await schedules.sweep()).toBe(0);
    expect(await schedules.sweep(0)).toBe(0);
    expect(await persistence.receipts.count({ kind: "occurrence" })).toBe(52);
  });
  it("refuses an old ready revision after an edit and never claims a disabled rule", async ({
    expect,
  }) => {
    const row = await rule(config(), true);
    await alepha.inject(AutomationSchedules).sweep();
    const receipt = await persistence.receipts.getOne({
      where: { automationId: row.id },
    });
    await persistence.rules.updateById(row.id, {
      revision: row.revision + 1,
      enabled: false,
    });
    const prepared = await alepha.inject(AutomationRunEvidence).prepare({
      rule: row,
      occurrenceId: receipt.occurrenceId,
      triggeredAt: receipt.occurredAt,
    });
    const result = await alepha.inject(AutomationClaims).claim({
      automationId: row.id,
      revision: row.revision,
      source: { kind: "schedule", scheduledAt: receipt.occurredAt },
      prepared,
    });
    expect(result.state).toBe("terminal");
    expect((await persistence.receipts.getById(receipt.id)).status).toBe(
      "refused",
    );
    expect(await alepha.inject(AutomationSchedules).sweep()).toBe(0);
  });
  it("selects at most 50 stable rows, includes held quests and excludes draft, completed and shelved work", async ({
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
      title: "Completed",
    });
    await createTestQuest(alepha, project, {
      shelvedAt: time.nowISOString(),
      tags: ["daily"],
      title: "Shelved",
    });
    for (let index = 0; index < 51; index += 1)
      await createTestQuest(alepha, project, {
        tags: ["daily"],
        ...(index === 0 ? { heldAt: time.nowISOString() } : {}),
      });
    const row = await rule();
    const first = await evaluate(row);
    expect(first.items).toHaveLength(50);
    expect(first).toMatchObject({
      kind: "rows",
      total: 51,
      totalIsExact: false,
      hasMore: true,
      truncated: true,
    });
    expect(first.items[0].status).toBe("on_hold");
    expect(first.items.map((item) => item.shortId)).toEqual(
      first.items.map((item) => Number(item.shortId)).sort((a, b) => a - b),
    );
    expect(first.next).toBeUndefined();
    const rowCursor = {
      shortId: Number(first.items.at(-1)!.shortId),
      seen: 50,
    };
    const last = await evaluate(row, rowCursor);
    expect(last.items).toHaveLength(1);
    expect(last).toMatchObject({
      total: 51,
      totalIsExact: true,
      hasMore: false,
    });
    const digest = await evaluate(
      await rule(config("collection", "quests.tagged")),
    );
    expect(digest.contexts).toHaveLength(1);
    expect(digest.items).toHaveLength(50);
    expect(digest.next).toBeUndefined();
    const rendered = alepha
      .inject(AutomationTemplateRenderer)
      .render(
        config("collection", "quests.tagged").actions[0],
        digest.contexts[0],
        [],
      );
    expect(rendered).toMatchObject({
      suppressed: false,
      truncated: true,
      shown: 50,
    });
    await expect(
      evaluate(await rule(config("collection", "quests.tagged")), rowCursor),
    ).rejects.toThrow("Only row selectors");
  });
  it("evaluates one scalar including real zero, suppresses empty collections and rejects arbitrary filters", async ({
    expect,
  }) => {
    const scalar = await evaluate(await rule(config("scalar", "activeQuests")));
    expect(scalar).toMatchObject({ kind: "scalar", total: 1, noData: false });
    expect(scalar.contexts).toHaveLength(1);
    expect(scalar.contexts[0].values.value).toBe(0);
    const digest = await evaluate(
      await rule(config("collection", "quests.tagged")),
    );
    expect(
      alepha
        .inject(AutomationTemplateRenderer)
        .render(
          config("collection", "quests.tagged").actions[0],
          digest.contexts[0],
          [],
        ),
    ).toMatchObject({ suppressed: true, reason: "empty_collection" });
    const unsafe = config();
    unsafe.select!.filters.sql = "SELECT * FROM users";
    await expect(rule(unsafe)).rejects.toThrow("unknown slot");
  });
  it("reports summary byte truncation even when the query total is exact", async ({
    expect,
  }) => {
    for (let index = 0; index < 50; index += 1)
      await createTestQuest(alepha, project, {
        title: "😀".repeat(90),
        tags: ["daily"],
      });
    const digest = await evaluate(
      await rule(config("collection", "quests.tagged")),
    );
    expect(digest).toMatchObject({
      total: 50,
      totalIsExact: true,
      hasMore: false,
      truncated: true,
    });
    expect(digest.contexts[0].collection?.truncated).toBe(true);
  });
  it("indexes both due scheduling and unfinished occurrence checks", async ({
    expect,
  }) => {
    const plan = await alepha
      .inject(DatabaseProvider)
      .execute(
        sql`EXPLAIN QUERY PLAN SELECT id FROM automations WHERE enabled = TRUE AND health = 'active' AND requires_approval = FALSE AND deleted_at IS NULL AND next_run_at <= ${time.nowMillis()} AND NOT EXISTS (SELECT 1 FROM automation_receipts WHERE automation_id = automations.id AND kind = 'occurrence' AND status IN ('ready', 'claimed')) ORDER BY next_run_at, id LIMIT 51`,
      );
    expect(JSON.stringify(plan)).toContain("next_run_at");
    expect(JSON.stringify(plan)).toContain(
      "automation_receipts_rule_state_idx",
    );
  });
  it("uses the reminder due index to filter before its stable cap", async ({
    expect,
  }) => {
    const plan = await alepha
      .inject(DatabaseProvider)
      .execute(
        sql`EXPLAIN QUERY PLAN SELECT id FROM quests WHERE project_id = ${project.id} AND deleted_at IS NULL AND completed_at IS NULL AND shelved_at IS NULL AND accepted_at IS NOT NULL AND accepted_by IS NOT NULL AND reminder_interval IS NOT NULL AND reminder_next_at IS NOT NULL AND reminder_next_at <= ${time.nowMillis()} ORDER BY reminder_next_at ASC, short_id ASC LIMIT 51`,
      );
    expect(JSON.stringify(plan)).toContain("quests_automation_reminders_idx");
  });
  it("recompiles a shared cron and rearms only a changed schedule", async ({
    expect,
  }) => {
    const variables = alepha.inject(AutomationVariables);
    await variables.set(project.id, user, {
      key: "cadence",
      value: { kind: "text", value: "0 * * * *" },
    });
    const ast = config();
    ast.trigger = { kind: "schedule", cron: "{{cadence}}" };
    const row = await rule(ast, true);
    const cadence = await persistence.variables.getOne({
      where: { projectId: project.id, key: "cadence" },
    });
    await variables.set(project.id, user, {
      key: "cadence",
      version: cadence.version,
      value: { kind: "text", value: "10 0 * * *" },
    });
    expect(await persistence.rules.getById(row.id)).toMatchObject({
      scheduleCron: "10 0 * * *",
      nextRunAt: cron.next("10 0 * * *", time.nowISOString()),
    });
    const latest = await persistence.variables.getById(cadence.id);
    await expect(
      variables.set(project.id, user, {
        key: "cadence",
        version: latest.version,
        value: { kind: "text", value: "* * * * *" },
      }),
    ).rejects.toThrow("five-minute");
    expect((await persistence.variables.getById(cadence.id)).value.value).toBe(
      "10 0 * * *",
    );
  });
  it("pages past the fifty-first reminder and advances due state only with its effect receipt", async ({
    expect,
  }) => {
    for (let index = 0; index < 51; index += 1)
      await createTestQuest(alepha, project, {
        acceptedAt: time.nowISOString(),
        acceptedBy: user.id,
        reminderInterval: index === 50 ? "weekly" : "daily",
        reminderNextAt: time.now().subtract(1, "hour").toISOString(),
      });
    const ast = config("rows", "quests.remindersDue");
    ast.actions[0] = {
      kind: "notify",
      recipient: "{{assignee_id}}",
      channel: "inbox",
      title: "Reminder",
      text: "{{title}}",
      category: "reminders",
    };
    const row = await rule(ast, true);
    const selections = alepha.inject(AutomationSelections);
    const first = await evaluate(row);
    const last = await evaluate(row, first.next);
    expect(first.items).toHaveLength(50);
    expect(last.items).toHaveLength(1);
    expect(last.items[0].reminder_interval).toBe("weekly");
    const settlement = selections.settlement(
      "quests.remindersDue",
      project.id,
      last.contexts[0],
      time.nowISOString(),
    )!;
    const occurrenceAt = cron.latest("*/5 * * * *", time.nowISOString());
    const prepared = await alepha.inject(AutomationRunEvidence).prepare({
      rule: row,
      occurrenceId: `schedule:${occurrenceAt}`,
      triggeredAt: occurrenceAt,
      selected: last.items,
      matched: 1,
      planned: [{ index: 0, row: 0 }],
    });
    const claimed = await alepha.inject(AutomationClaims).claim({
      automationId: row.id,
      revision: row.revision,
      source: { kind: "schedule", scheduledAt: occurrenceAt },
      prepared,
    });
    expect(claimed.state).toBe("claimed");
    const action = {
      kind: "notify" as const,
      recipient: user.id,
      channel: "inbox",
      title: "Reminder",
      text: String(last.items[0].title),
      category: "reminders" as const,
    };
    const before = await entities.quests.getById(
      Number(last.items[0].quest_id),
    );
    expect(before.reminderNextAt).toBe(last.items[0].reminder_next_at);
    await alepha
      .inject(DatabaseProvider)
      .execute(
        "CREATE TABLE reminder_test_effect (id TEXT PRIMARY KEY NOT NULL)",
      );
    await expect(
      alepha
        .inject(AutomationClaims)
        .atomicEffect(claimed.receipt!.id, claimed.receipt!.leaseToken!, {
          index: 0,
          row: 0,
          action,
          condition: sql`FALSE`,
          statements: [
            sql`INSERT INTO reminder_test_effect VALUES ('delivered')`,
            ...settlement.statements,
          ],
          result: { queued: true },
        }),
    ).rejects.toThrow("Atomic automation batch failed");
    expect((await entities.quests.getById(before.id)).reminderNextAt).toBe(
      before.reminderNextAt,
    );
    expect(
      await alepha
        .inject(DatabaseProvider)
        .execute("SELECT COUNT(*) AS n FROM reminder_test_effect"),
    ).toEqual([{ n: 0 }]);
    const receipt = await alepha
      .inject(AutomationClaims)
      .atomicEffect(claimed.receipt!.id, claimed.receipt!.leaseToken!, {
        index: 0,
        row: 0,
        action,
        condition: settlement.condition,
        statements: [
          sql`INSERT INTO reminder_test_effect VALUES ('delivered')`,
          ...settlement.statements,
        ],
        changedTables: settlement.changedTables,
        result: { queued: true },
      });
    expect(receipt.status).toBe("committed");
    const after = await entities.quests.getById(before.id);
    // Hours, not days: the interval is an exact 7 * DAY_MS, and a local
    // "7 days" gains or loses an hour across a DST change.
    expect(after.reminderNextAt).toBe(
      time.now().add(7 * 24, "hours").toISOString(),
    );
    expect(after.history.at(-1)).toMatchObject({
      action: "reminder_sent",
      by: user.id,
    });
    expect(
      await entities.quests.findMany({
        where: {
          projectId: project.id,
          reminderNextAt: { lte: time.nowISOString() },
        },
      }),
    ).toHaveLength(50);
  });
});
