import { Alepha } from "alepha";
import { MemberService } from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import { DbConflictError } from "alepha/orm";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreCoreApi } from "../src/api/index.ts";
import {
  automationRuleSchema,
  type AutomationRule,
} from "../src/api/schemas/automationRuleSchema.ts";
import {
  automationRunSnapshotSchema,
  type AutomationRunSnapshot,
} from "../src/api/schemas/automationRunSnapshotSchema.ts";
import { AutomationPersistence } from "../src/api/services/AutomationPersistence.ts";
import {
  CoreTestEntities,
  createTestMember,
  createTestProject,
} from "../src/testing/index.ts";

/**
 * Exercise real SQL constraints and lifecycle hooks with transactions disabled.
 */
describe("Automation persistence", () => {
  let alepha: Alepha;
  let entities: CoreTestEntities;
  let persistence: AutomationPersistence;

  const eventRule = (): AutomationRule => ({
    version: 1,
    trigger: { kind: "event", event: "feedback.created" },
    select: null,
    guard: null,
    actions: [
      {
        kind: "notify",
        recipient: "{{recipient}}",
        channel: "inbox",
        title: "New feedback",
        text: "{{title}}",
        category: "automations",
      },
    ],
  });

  const snapshot = (rule: AutomationRule): AutomationRunSnapshot => ({
    rule,
    inputs: { title: "Safe title" },
    variables: [
      {
        key: "recipient",
        version: 1,
        value: { kind: "member", value: crypto.randomUUID() },
      },
    ],
    selected: [{ shortId: 1, title: "One quest" }],
    counts: {
      selected: 1,
      matched: 1,
      executed: 1,
      deliveries: 1,
      skipped: 0,
      total: 1,
      totalIsExact: true,
      truncated: false,
      hasMore: false,
    },
    actions: [
      {
        index: 0,
        status: "queued",
        result: { delivery: "enqueued" },
        receiptId: "receipt-1",
      },
    ],
  });

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        DATABASE_TRANSACTIONS: false,
        LOG_LEVEL: "error",
        SERVER_PORT: 0,
      },
    }).with(LoreCoreApi);
    entities = alepha.inject(CoreTestEntities);
    persistence = alepha.inject(AutomationPersistence);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  it("starts disabled, keeps enable intent apart from health, and rejects author changes", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha);
    const other = await entities.users.create({});
    const rule = await persistence.rules.create({
      projectId: project.id,
      authorUserId: project.createdBy,
      title: "Feedback",
      rule: eventRule(),
    });
    expect(rule.enabled).toBe(false);
    expect(rule.health).toBe("active");
    await expect(
      persistence.rules.create({
        projectId: project.id,
        authorUserId: project.createdBy,
        title: "Unsafe create",
        enabled: true,
        rule: eventRule(),
      }),
    ).rejects.toThrow("disabled");
    await expect(
      persistence.rules.updateById(rule.id, { authorUserId: other.id }),
    ).rejects.toThrow("immutable");
    const enabled = await persistence.rules.updateById(rule.id, {
      enabled: true,
      health: "paused",
      reason: "Review required",
    });
    expect(enabled.enabled).toBe(true);
    expect(enabled.health).toBe("paused");
  });

  it("pauses a departed author's rules and retains evidence through soft deletion", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha);
    const author = await entities.users.create({});
    const member = await createTestMember(alepha, project, author.id);
    const rule = await persistence.rules.create({
      projectId: project.id,
      authorUserId: member.userId,
      title: "Member rule",
      rule: eventRule(),
    });
    await persistence.rules.updateById(rule.id, { enabled: true });
    const now = alepha.inject(DateTimeProvider).now().toISOString();
    const run = await persistence.runs.create({
      projectId: project.id,
      automationId: rule.id,
      ruleRevision: rule.revision,
      occurrenceId: "feedback:1",
      triggeredAt: now,
      status: "succeeded",
      snapshot: snapshot(eventRule()),
      finishedAt: now,
    });
    await alepha
      .inject(MemberService)
      .remove(project.organizationId!, member.userId, {
        id: project.createdBy,
      });
    const paused = await persistence.rules.getById(rule.id);
    expect(paused).toMatchObject({
      enabled: true,
      health: "paused",
      requiresApproval: true,
      authorUserId: member.userId,
    });
    await expect(
      entities.users.deleteById(member.userId, { force: true }),
    ).rejects.toThrow();
    await expect(
      alepha.events.emit("user:delete:before", { userId: member.userId }),
    ).rejects.toThrow("authored automations");
    await persistence.rules.deleteById(rule.id);
    expect(await persistence.rules.findById(rule.id)).toBeUndefined();
    expect((await persistence.runs.getById(run.id)).snapshot).toEqual(
      run.snapshot,
    );
    await expect(
      entities.users.deleteById(member.userId, { force: true }),
    ).rejects.toThrow();
    expect(await entities.users.findById(member.userId)).toBeDefined();
    await expect(
      alepha.events.emit("user:delete:before", { userId: member.userId }),
    ).rejects.toThrow("authored automations");
    await entities.projects.deleteById(project.id, { force: true });
    expect(await persistence.runs.findById(run.id)).toBeUndefined();
  });

  it.for(["rows", "scalar", "collection"] as const)(
    "round-trips a %s selection and a bounded run envelope",
    async (kind, { expect }) => {
      const project = await createTestProject(alepha);
      const definition: AutomationRule = {
        ...eventRule(),
        trigger: { kind: "schedule", cron: "0 0 * * *" },
        select: { kind, key: "quests.tagged", filters: { tag: "reminder" } },
      };
      const rule = await persistence.rules.create({
        projectId: project.id,
        authorUserId: project.createdBy,
        title: kind,
        rule: definition,
        nextRunAt: "2026-10-16T00:00:00.000Z",
        baseline: { value: 7, revision: 1 },
      });
      const payload = snapshot(definition);
      const run = await persistence.runs.create({
        projectId: project.id,
        automationId: rule.id,
        ruleRevision: rule.revision,
        occurrenceId: "2026-10-16T00:00:00.000Z",
        triggeredAt: "2026-10-16T00:00:00.000Z",
        status: "queued",
        snapshot: payload,
      });
      expect((await persistence.rules.getById(rule.id)).rule).toEqual(
        definition,
      );
      expect((await persistence.runs.getById(run.id)).snapshot).toEqual(
        payload,
      );
      const changed = await persistence.rules.updateById(rule.id, {
        title: "Edited",
        revision: rule.revision + 1,
      });
      expect(changed.revision).toBe(rule.revision + 1);
      const scheduled = await persistence.rules.updateById(rule.id, {
        nextRunAt: "2026-10-17T00:00:00.000Z",
      });
      expect(scheduled.revision).toBe(changed.revision);
      expect(scheduled.version).toBe(changed.version + 1);
    },
  );

  it("makes variable keys unique per project and advances their version", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha);
    const variable = await persistence.variables.create({
      projectId: project.id,
      key: "threshold",
      value: { kind: "number", value: 5 },
    });
    await expect(
      persistence.variables.create({
        projectId: project.id,
        key: "threshold",
        value: { kind: "text", value: "duplicate" },
      }),
    ).rejects.toThrow(DbConflictError);
    const changed = await persistence.variables.updateById(variable.id, {
      value: { kind: "number", value: 6 },
    });
    expect(changed.version).toBe(variable.version + 1);
  });

  it("rejects oversized UTF-8 snapshots, too many actions and illegal selection cardinalities", ({
    expect,
  }) => {
    const large = snapshot(eventRule());
    large.selected = Array.from({ length: 50 }, () => ({
      title: "🌱".repeat(1000),
    }));
    expect(automationRunSnapshotSchema.safeParse(large).success).toBe(false);
    expect(
      automationRuleSchema.safeParse({
        ...eventRule(),
        actions: Array(6).fill(eventRule().actions[0]),
      }).success,
    ).toBe(false);
    expect(
      automationRuleSchema.safeParse({
        ...eventRule(),
        select: { kind: "rows", key: "quests", filters: {} },
      }).success,
    ).toBe(false);
    expect(
      automationRuleSchema.safeParse({
        ...eventRule(),
        actions: [{ kind: "project:delete" }],
      }).success,
    ).toBe(false);
  });
});
