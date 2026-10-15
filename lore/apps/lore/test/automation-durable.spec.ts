import {
  AutomationAtomic,
  AutomationClaims,
  AutomationDatabase,
  AutomationDispatchRegistry,
  AutomationEvents,
  AutomationEventDispatch,
  AutomationPersistence,
  AutomationRoster,
  AutomationRunEvidence,
} from "@lore/core/api";
import type { AutomationRule } from "@lore/core/schemas";
import { Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { DatabaseProvider, sql } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { beforeEach, afterEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  TestEntityRepositories,
  createTestProject,
} from "./fixtures/entities.ts";

class DeferredEventDispatch {}

describe("Durable automation dispatch", () => {
  let alepha: Alepha;
  let entities: TestEntityRepositories;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  let persistence: AutomationPersistence;
  let events: AutomationEvents;
  let claims: AutomationClaims;
  let evidence: AutomationRunEvidence;
  let provider: DatabaseProvider;
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
        title: "Source",
        text: "{{title}}",
        category: "automations",
      },
    ],
  });
  const createRule = async () => {
    const row = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Rule",
      rule: config(),
    });
    return persistence.rules.updateById(row.id, { enabled: true });
  };
  const createEvent = async (identity: string = crypto.randomUUID()) =>
    events.transition({
      projectId: project.id,
      name: "feedback.created",
      identity,
      fields: { title: "Safe source", credentials: "SECRET" },
      condition: sql`NOT EXISTS (SELECT 1 FROM automation_test_source WHERE id = ${identity})`,
      mutation: sql`INSERT INTO automation_test_source (id, value) VALUES (${identity}, 1) RETURNING id`,
      changedTables: ["automation_test_source"],
    });
  const prepare = async (
    rule: Awaited<ReturnType<typeof createRule>>,
    event: Awaited<ReturnType<typeof createEvent>>["event"],
  ) =>
    evidence.prepare({
      rule,
      occurrenceId: `event:${event.id}`,
      triggeredAt: event.occurredAt,
      inputs: event.payload.fields,
      selected: [event.payload.fields],
      matched: 1,
      planned: [{ index: 0 }],
    });
  const claim = async (
    rule: Awaited<ReturnType<typeof createRule>>,
    event: Awaited<ReturnType<typeof createEvent>>["event"],
  ) => {
    const result = await claims.claim({
      automationId: rule.id,
      revision: rule.revision,
      source: { kind: "event", eventId: event.id },
      prepared: await prepare(rule, event),
    });
    if (result.state !== "claimed" || !result.receipt?.leaseToken)
      throw new AlephaError(`Expected claim, received ${result.state}`);
    return result.receipt;
  };
  const effect = (key = "one") => ({
    index: 0,
    action: {
      kind: "notify" as const,
      recipient: user.id,
      channel: "inbox",
      title: "Source",
      text: "Safe source",
      category: "automations" as const,
    },
    statements: [
      sql`INSERT INTO automation_test_effects (id, hits) VALUES (${key}, 1) ON CONFLICT (id) DO UPDATE SET hits = automation_test_effects.hits + 1 RETURNING id`,
    ],
    result: { changed: true },
    changedTables: ["automation_test_effects"],
  });
  const expire = async (id: string) =>
    persistence.receipts.updateById(id, {
      leaseUntil: alepha
        .inject(DateTimeProvider)
        .now()
        .subtract(3, "minutes")
        .toISOString(),
    });

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "error" },
    });
    alepha.with({
      provide: AutomationEventDispatch,
      use: DeferredEventDispatch,
    });
    bootLore(alepha, ["api"]);
    entities = alepha.inject(TestEntityRepositories);
    persistence = alepha.inject(AutomationPersistence);
    events = alepha.inject(AutomationEvents);
    claims = alepha.inject(AutomationClaims);
    evidence = alepha.inject(AutomationRunEvidence);
    provider = alepha.inject(DatabaseProvider);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [
        { key: "work", options: { automations: true } },
        { key: "support" },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await alepha
      .inject(AutomationDatabase)
      .batch([
        "CREATE TABLE automation_test_source (id TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL)",
        "CREATE TABLE automation_test_effects (id TEXT PRIMARY KEY NOT NULL, hits INTEGER NOT NULL)",
      ]);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("commits a safe source intent and deduplicates the same transition identity", async ({
    expect,
  }) => {
    const first = await createEvent("source-transition-1");
    expect(first.committed).toBe(true);
    expect(first.event.payload.fields).toEqual({ title: "Safe source" });
    expect(new Date(first.event.occurredAt).getTime()).toBeGreaterThan(0);
    expect(JSON.stringify(first.event)).not.toContain("SECRET");
    const repeated = await createEvent("source-transition-1");
    expect(repeated).toMatchObject({
      committed: false,
      event: { id: first.event.id },
    });
    expect(
      await provider.execute(
        "SELECT COUNT(*) AS n FROM automation_test_source",
      ),
    ).toEqual([{ n: 1 }]);
    expect(await persistence.events.count()).toBe(1);
    expect(await persistence.receipts.count({ kind: "guard" })).toBe(0);
  });

  it("rolls back source writes when an intent fails and when a guard predicate is false", async ({
    expect,
  }) => {
    const atomic = alepha.inject(AutomationAtomic);
    await expect(
      atomic.guarded(project.id, sql`FALSE`, [
        sql`INSERT INTO automation_test_source VALUES ('lost-claim', 1)`,
      ]),
    ).rejects.toThrow("Atomic automation batch failed");
    await expect(
      atomic.guarded(project.id, sql`TRUE`, [
        sql`INSERT INTO automation_test_source VALUES ('source', 1)`,
        sql`INSERT INTO automation_events (id, project_id) VALUES (${crypto.randomUUID()}, -1)`,
      ]),
    ).rejects.toThrow("Atomic automation batch failed");
    expect(
      await provider.execute(
        "SELECT COUNT(*) AS n FROM automation_test_source",
      ),
    ).toEqual([{ n: 0 }]);
    expect(await persistence.receipts.count({ kind: "guard" })).toBe(0);
  });

  it("sweeps a committed intent after a worker exit and leaves failed dispatch discoverable", async ({
    expect,
  }) => {
    const source = await createEvent();
    expect(await events.sweep()).toBe(0);
    let fail = true;
    events.register(async () => {
      if (fail) throw new AlephaError("Worker exited before enqueue");
      return { done: true, claimed: 1 };
    });
    expect(await events.sweep()).toBe(0);
    expect(
      (await persistence.events.getById(source.event.id)).dispatchedAt,
    ).toBeUndefined();
    fail = false;
    expect(await events.sweep()).toBe(1);
    expect(
      (await persistence.events.getById(source.event.id)).dispatchedAt,
    ).toBeDefined();
    expect(
      (await persistence.events.getById(source.event.id)).payload.fields,
    ).toEqual({});
  });

  it("reserves durable source intent before evaluation and recovers it after dispatcher exit", async ({
    expect,
  }) => {
    const rule = await createRule();
    const source = await createEvent();
    const ready = await claims.reserve({
      automationId: rule.id,
      revision: 0,
      source: { kind: "event", eventId: source.event.id },
    });
    expect(ready).toMatchObject({
      status: "ready",
      snapshot: {
        inputs: { title: "Safe source" },
        selected: [],
        variables: [],
      },
    });
    expect(ready.snapshot?.evaluatedAt).toBeUndefined();
    expect(await persistence.runs.count()).toBe(0);
    const queued: string[] = [];
    claims.registerRecovery(async (receipt) => {
      queued.push(receipt.id);
    });
    expect(await claims.sweepRecovery(50)).toBe(1);
    expect(queued).toEqual([ready.id]);
    await persistence.events.updateById(source.event.id, {
      dispatchedAt: alepha.inject(DateTimeProvider).nowISOString(),
      payload: { fields: {}, omitted: ["payload_retired"] },
    });
    const prepared = await evidence.prepare({
      rule,
      occurrenceId: ready.occurrenceId,
      triggeredAt: ready.occurredAt,
      inputs: ready.snapshot!.inputs,
      selected: [ready.snapshot!.inputs],
      matched: 1,
      planned: [{ index: 0 }],
    });
    const active = await claims.claim({
      automationId: rule.id,
      revision: 0,
      source: { kind: "event", eventId: source.event.id },
      prepared,
    });
    expect(active).toMatchObject({
      state: "claimed",
      receipt: { id: ready.id, snapshot: { inputs: { title: "Safe source" } } },
    });
    expect(await persistence.runs.count()).toBe(1);
  });

  it("couples a due cursor advance and a durable scheduled reservation atomically", async ({
    expect,
  }) => {
    const configuration = config();
    configuration.trigger = { kind: "schedule", cron: "*/5 * * * *" };
    configuration.select = { kind: "scalar", key: "activeQuests", filters: {} };
    const created = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Scheduled",
      rule: configuration,
      nextRunAt: "2026-10-15T10:00:00.000Z",
    });
    const rule = await persistence.rules.updateById(created.id, {
      enabled: true,
    });
    const next = alepha
      .inject(DateTimeProvider)
      .now()
      .add(5, "minutes")
      .toISOString();
    const encoded = alepha.inject(AutomationDatabase).timestamp(next);
    const request = {
      automationId: rule.id,
      revision: 0,
      source: {
        kind: "schedule" as const,
        scheduledAt: "2026-10-15T10:00:00.000Z",
      },
      condition: sql`EXISTS (SELECT 1 FROM automations WHERE id = ${rule.id} AND version = ${rule.version})`,
      mutation: sql`UPDATE automations SET next_run_at = ${encoded}, version = version + 1 WHERE id = ${rule.id} AND version = ${rule.version}`,
      changedTables: ["automations"],
    };
    const ready = await claims.reserve(request);
    expect(ready.status).toBe("ready");
    expect((await persistence.rules.getById(rule.id)).nextRunAt).toBe(next);
    expect((await claims.reserve(request)).id).toBe(ready.id);
    expect((await persistence.rules.getById(rule.id)).version).toBe(
      rule.version + 1,
    );
    const prepared = await evidence.prepare({
      rule,
      occurrenceId: ready.occurrenceId,
      triggeredAt: ready.occurredAt,
      selected: [{ value: 0, title: "Open quests" }],
      matched: 1,
      planned: [{ index: 0 }],
    });
    const active = await claims.claim({
      automationId: rule.id,
      revision: 0,
      source: request.source,
      prepared,
    });
    expect(active).toMatchObject({
      state: "claimed",
      receipt: {
        id: ready.id,
        occurrenceId: "schedule:2026-10-15T10:00:00.000Z",
      },
    });
    expect(
      await persistence.receipts.count({
        kind: "occurrence",
        automationId: rule.id,
      }),
    ).toBe(1);
  });

  it("grants one occurrence lease across duplicate ticks and different overlapping events", async ({
    expect,
  }) => {
    const rule = await createRule();
    const source = await createEvent();
    const prepared = await prepare(rule, source.event);
    const request = {
      automationId: rule.id,
      revision: 0,
      source: { kind: "event" as const, eventId: source.event.id },
      prepared,
    };
    const results = await Promise.all([
      claims.claim(request),
      claims.claim(request),
    ]);
    expect(results.filter((result) => result.state === "claimed")).toHaveLength(
      1,
    );
    expect(await persistence.receipts.count({ kind: "occurrence" })).toBe(1);
    const another = await createEvent();
    expect(
      (
        await claims.claim({
          ...request,
          source: { kind: "event", eventId: another.event.id },
        })
      ).state,
    ).toBe("busy");
    expect(await persistence.runs.count()).toBe(1);
  });

  it("recovers a lease without letting its previous worker commit an effect", async ({
    expect,
  }) => {
    const rule = await createRule();
    const source = await createEvent();
    const first = await claim(rule, source.event);
    await expire(first.id);
    const resumed = await claim(rule, source.event);
    expect(resumed.leaseToken).not.toBe(first.leaseToken);
    await expect(
      claims.atomicEffect(first.id, first.leaseToken!, effect()),
    ).rejects.toThrow("lease");
    const committed = await claims.atomicEffect(
      resumed.id,
      resumed.leaseToken!,
      effect(),
    );
    expect(committed.status).toBe("committed");
    expect(
      await provider.execute(
        "SELECT hits FROM automation_test_effects WHERE id = 'one'",
      ),
    ).toEqual([{ hits: 1 }]);
  });

  it("couples database effects to their receipts and safely retries a rolled-back batch", async ({
    expect,
  }) => {
    const rule = await createRule();
    const occurrence = await claim(rule, (await createEvent()).event);
    const input = effect();
    await expect(
      claims.atomicEffect(occurrence.id, occurrence.leaseToken!, {
        ...input,
        statements: [
          ...input.statements,
          sql`INSERT INTO automation_test_effects VALUES ('one', 99)`,
        ],
      }),
    ).rejects.toThrow("Atomic automation batch failed");
    expect(
      await provider.execute(
        "SELECT COUNT(*) AS n FROM automation_test_effects",
      ),
    ).toEqual([{ n: 0 }]);
    const committed = await claims.atomicEffect(
      occurrence.id,
      occurrence.leaseToken!,
      input,
    );
    const again = await claims.atomicEffect(
      occurrence.id,
      occurrence.leaseToken!,
      input,
    );
    expect(again.id).toBe(committed.id);
    expect(
      await provider.execute(
        "SELECT hits FROM automation_test_effects WHERE id = 'one'",
      ),
    ).toEqual([{ hits: 1 }]);
    await claims.advance(occurrence.id, occurrence.leaseToken!, {
      index: 0,
      receiptId: committed.id,
    });
    await claims.complete(occurrence.id, occurrence.leaseToken!);
    expect(
      (await persistence.receipts.getById(occurrence.id)).snapshot,
    ).toBeUndefined();
  });

  it("cancels old revisions and records the refusal instead of leaving live-looking detail", async ({
    expect,
  }) => {
    const rule = await createRule();
    const source = await createEvent();
    const occurrence = await claim(rule, source.event);
    await persistence.rules.updateById(rule.id, { revision: 1 });
    await expect(
      claims.atomicEffect(occurrence.id, occurrence.leaseToken!, effect()),
    ).rejects.toThrow("revision changed");
    await expire(occurrence.id);
    const recovered = await claims.claim({
      automationId: rule.id,
      revision: 0,
      source: { kind: "event", eventId: source.event.id },
      prepared: await prepare(rule, source.event),
    });
    expect(recovered).toMatchObject({
      state: "terminal",
      receipt: { status: "refused" },
    });
    expect(await persistence.runs.getById(occurrence.runId!)).toMatchObject({
      status: "refused",
    });
    expect(
      await provider.execute(
        "SELECT COUNT(*) AS n FROM automation_test_effects",
      ),
    ).toEqual([{ n: 0 }]);
  });

  it("records an ambiguous external attempt as unknown and never sends it again", async ({
    expect,
  }) => {
    const rule = await createRule();
    const occurrence = await claim(rule, (await createEvent()).event);
    let sends = 0;
    const input = {
      index: 0,
      action: effect().action,
      perform: async () => {
        sends += 1;
        throw new AlephaError("Response lost after send");
      },
    };
    expect(
      (
        await claims.externalEffect(
          occurrence.id,
          occurrence.leaseToken!,
          input,
        )
      ).status,
    ).toBe("unknown");
    await expect(
      claims.externalEffect(occurrence.id, occurrence.leaseToken!, input),
    ).rejects.toThrow();
    expect(sends).toBe(1);
    expect(await persistence.rules.getById(rule.id)).toMatchObject({
      health: "paused",
      requiresApproval: true,
    });
    expect(await persistence.runs.getById(occurrence.runId!)).toMatchObject({
      status: "unknown",
    });
  });

  it("resumes an external claim that never started", async ({ expect }) => {
    const rule = await createRule();
    const source = await createEvent();
    const occurrence = await claim(rule, source.event);
    await claims.beginAction(occurrence.id, occurrence.leaseToken!, {
      index: 0,
      action: effect().action,
      mode: "external",
    });
    await expire(occurrence.id);
    const resumed = await claim(rule, source.event);
    let sends = 0;
    const committed = await claims.externalEffect(
      resumed.id,
      resumed.leaseToken!,
      {
        index: 0,
        action: effect().action,
        perform: async () => {
          sends += 1;
          return { changed: true };
        },
      },
    );
    expect(committed.status).toBe("committed");
    expect(sends).toBe(1);
  });

  it("marks an external start abandoned by a worker unknown during recovery", async ({
    expect,
  }) => {
    const rule = await createRule();
    const source = await createEvent();
    const occurrence = await claim(rule, source.event);
    const action = await claims.beginAction(
      occurrence.id,
      occurrence.leaseToken!,
      { index: 0, action: effect().action, mode: "external" },
    );
    await persistence.receipts.updateById(action.id, {
      result: { started: true },
    });
    await expire(occurrence.id);
    const recovered = await claims.claim({
      automationId: rule.id,
      revision: 0,
      source: { kind: "event", eventId: source.event.id },
      prepared: await prepare(rule, source.event),
    });
    expect(recovered).toMatchObject({
      state: "terminal",
      receipt: { status: "unknown" },
    });
    expect(await persistence.receipts.getById(action.id)).toMatchObject({
      status: "unknown",
    });
    expect(await persistence.runs.getById(occurrence.runId!)).toMatchObject({
      status: "unknown",
    });
    expect(await persistence.rules.getById(rule.id)).toMatchObject({
      health: "paused",
      requiresApproval: true,
    });
  });

  it("preserves a full 210-delivery roster through a mid-chunk crash without duplicate effects", async ({
    expect,
  }) => {
    const members = await entities.users.createMany(
      Array.from({ length: 105 }, () => ({ roles: ["user"] })),
    );
    await entities.organizationMembers.createMany(
      members.map((member) => ({
        organizationId: project.organizationId!,
        userId: member.id,
        rank: "owner",
      })),
    );
    const rule = await createRule();
    const source = await createEvent();
    let occurrence = await claim(rule, source.event);
    const rosterService = alepha.inject(AutomationRoster);
    const roster = await rosterService.freeze(
      occurrence.id,
      occurrence.leaseToken!,
      { index: 0, channels: ["inbox", "email"], excludeUserId: user.id },
    );
    const late = await entities.users.create({ roles: ["user"] });
    await entities.organizationMembers.create({
      organizationId: project.organizationId!,
      userId: late.id,
      rank: "owner",
    });
    let page = await rosterService.chunk(roster.id, occurrence.leaseToken!);
    expect(page.total).toBe(210);
    expect(page.recipients).toHaveLength(100);
    const send = async (
      recipient: (typeof page.recipients)[number],
      runId: string,
    ) =>
      claims.atomicEffect(occurrence.id, occurrence.leaseToken!, {
        index: 0,
        runId,
        deliveryKey: recipient.id,
        action: {
          kind: "notify",
          recipient: recipient.recipientUserId!,
          channel: recipient.recipientChannel!,
          title: "Source",
          text: "Safe source",
          category: "automations",
        },
        statements: [
          sql`INSERT INTO automation_test_effects (id, hits) VALUES (${recipient.id}, 1) ON CONFLICT (id) DO UPDATE SET hits = automation_test_effects.hits + 1 RETURNING id`,
        ],
        result: { enqueued: true, outbox_id: crypto.randomUUID() },
      });
    // These effects committed, but neither the recipient acknowledgments nor
    // the chunk cursor were advanced before the worker exited.
    for (const recipient of page.recipients.slice(0, 50))
      await send(recipient, page.run.id);
    await expire(occurrence.id);
    occurrence = await claim(rule, source.event);
    page = await rosterService.chunk(roster.id, occurrence.leaseToken!);
    const sizes: number[] = [];
    for (;;) {
      sizes.push(page.recipients.length);
      for (const recipient of page.recipients) {
        const receipt = await send(recipient, page.run.id);
        await rosterService.acknowledge(
          roster.id,
          occurrence.leaseToken!,
          recipient.id,
          receipt.id,
        );
      }
      if (sizes.length === 1)
        await expect(
          claims.atomicEffect(occurrence.id, occurrence.leaseToken!, {
            ...effect("overflow"),
            runId: page.run.id,
            deliveryKey: "overflow",
          }),
        ).rejects.toThrow("100");
      await evidence.action(page.run.id, {
        index: 0,
        status: "queued",
        receiptId: page.chunk.id,
        deliveries: page.recipients.length,
        result: { enqueued: true },
      });
      await evidence.finish(page.run.id);
      const progress = await rosterService.advance(
        roster.id,
        occurrence.leaseToken!,
      );
      if (!progress.hasMore) break;
      await claims.yield(occurrence.id, occurrence.leaseToken!);
      occurrence = await claim(rule, source.event);
      page = await rosterService.chunk(roster.id, occurrence.leaseToken!);
    }
    expect(sizes).toEqual([100, 100, 10]);
    expect(
      await provider.execute(
        "SELECT COUNT(*) AS n, SUM(hits) AS hits FROM automation_test_effects",
      ),
    ).toEqual([{ n: 210, hits: 210 }]);
    expect(
      await persistence.receipts.count({
        kind: "recipient",
        recipientUserId: late.id,
      }),
    ).toBe(0);
    await claims.advance(occurrence.id, occurrence.leaseToken!, {
      index: 0,
      receiptId: roster.id,
    });
    await claims.complete(occurrence.id, occurrence.leaseToken!);
    expect(await persistence.runs.count({ status: "queued" })).toBe(0);
    expect(
      (await persistence.receipts.getById(occurrence.id)).snapshot,
    ).toBeUndefined();
  }, 120_000);

  it("retains receipts after detail pruning and refuses expired replay after receipt pruning", async ({
    expect,
  }) => {
    const rule = await createRule();
    const source = await createEvent();
    const occurrence = await claim(rule, source.event);
    const receipt = await claims.atomicEffect(
      occurrence.id,
      occurrence.leaseToken!,
      effect(),
    );
    await evidence.action(occurrence.runId!, {
      index: 0,
      status: "succeeded",
      receiptId: receipt.id,
    });
    await evidence.finish(occurrence.runId!);
    await claims.advance(occurrence.id, occurrence.leaseToken!, {
      index: 0,
      receiptId: receipt.id,
    });
    await claims.complete(occurrence.id, occurrence.leaseToken!);
    const old = alepha
      .inject(DateTimeProvider)
      .now()
      .subtract(31, "days")
      .toISOString();
    await persistence.runs.updateById(occurrence.runId!, { finishedAt: old });
    expect(await evidence.prune()).toBe(1);
    expect((await persistence.receipts.getById(receipt.id)).status).toBe(
      "committed",
    );
    expect(
      (
        await claims.claim({
          automationId: rule.id,
          revision: 0,
          source: { kind: "event", eventId: source.event.id },
          prepared: await prepare(rule, source.event),
        })
      ).state,
    ).toBe("terminal");
    const expired = alepha
      .inject(DateTimeProvider)
      .now()
      .subtract(91, "days")
      .toISOString();
    await persistence.events.updateById(source.event.id, {
      occurredAt: expired,
      replayUntil: expired,
    });
    await persistence.receipts.updateMany(
      { automationId: rule.id },
      { replayUntil: expired },
    );
    expect(await claims.prune()).toBe(2);
    const replay = await claims.claim({
      automationId: rule.id,
      revision: 0,
      source: { kind: "event", eventId: source.event.id },
      prepared: await prepare(rule, source.event),
    });
    expect(replay).toMatchObject({
      state: "terminal",
      receipt: { status: "refused" },
    });
    expect(
      await provider.execute(
        "SELECT hits FROM automation_test_effects WHERE id = 'one'",
      ),
    ).toEqual([{ hits: 1 }]);
  });

  it("shares the fixed dispatcher's 50-claim budget across recovery, events and schedules", async ({
    expect,
  }) => {
    const registry = new AutomationDispatchRegistry();
    const budgets: number[] = [];
    registry.register("recovery", async (limit) => {
      budgets.push(limit);
      return 48;
    });
    registry.register("events", async (limit) => {
      budgets.push(limit);
      return 2;
    });
    registry.register("schedules", async (limit) => {
      budgets.push(limit);
      return 1;
    });
    expect(await registry.tick()).toBe(50);
    expect(budgets).toEqual([50, 2]);
  });
});
