import {
  AutomationEvents,
  AutomationPersistence,
  AutomationService,
  AutomationWorker,
} from "@lore/core/api";
import { automationLine, createPresetRanks } from "@lore/core/testing";
import { UptimeStateService } from "@lore/ship/api";
import { monitors } from "@lore/ship/schemas";
import { Alepha, AlephaError } from "alepha";
import { JobQueueProvider, jobExecutionEntity } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class MonitorQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class MonitorRows {
  public readonly monitors = $repository(monitors);
  public readonly jobs = $repository(jobExecutionEntity);
}

/**
 * Uptime records `monitor.down` and `monitor.up` (#Q3610): a confirmed
 * outage and its recovery each run a rule once; a single failed probe runs
 * none.
 */
describe("Monitor automation events (#Q3610)", () => {
  let alepha: Alepha;
  let persistence: AutomationPersistence;
  let rows: MonitorRows;
  let entities: TestEntityRepositories;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  let time: DateTimeProvider;
  const up = { ok: true, result: "up", latencyMs: 20 } as const;
  const down = {
    ok: false,
    result: "connection",
    latencyMs: 0,
    error: "Connection refused\n    at Socket.connect (node:net:1)",
  } as const;

  const finish = async (input: { receiptId: string; token?: string }) => {
    let next: typeof input | undefined = input;
    for (let index = 0; next && index < 20; index++)
      next = await alepha.inject(AutomationWorker).step(next, 3);
    if (next) throw new AlephaError("Monitor worker exceeded its step budget");
  };
  const dispatch = async (automationId: string) => {
    await alepha.inject(AutomationEvents).sweep(50);
    const ready = await persistence.receipts.findMany({
      where: { automationId, kind: "occurrence", status: "ready" },
    });
    for (const receipt of ready) await finish({ receiptId: receipt.id });
    return ready.length;
  };
  const rule = async (event: "monitor.down" | "monitor.up", monitor = "") =>
    alepha.inject(AutomationService).create(project.id, user, {
      title: event,
      enabled: true,
      rule: automationLine({
        trigger: {
          kind: "event",
          event,
          ...(monitor ? { monitor } : {}),
        },
        select: null,
        guard: null,
        actions: [
          {
            kind: "notify",
            recipient: user.id,
            channel: "inbox",
            category: "automations",
            title: "{{title}}",
            text: "{{monitor}} {{target}} {{error}}",
          },
        ],
      }),
    });
  const seed = (name = "Website") =>
    rows.monitors.create({
      projectId: project.id,
      name,
      kind: "http",
      target: "https://user:secret@example.test/health?token=abc#frag",
      confirmations: 2,
      statusSince: time.nowISOString(),
      nextCheckAt: time.nowISOString(),
    });
  const probe = async (id: string, result: typeof up | typeof down) => {
    await time.travel(1, "minute");
    return alepha
      .inject(UptimeStateService)
      .apply(await rows.monitors.getById(id), result, time.nowMillis());
  };

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: MonitorQueue });
    bootLore(alepha);
    entities = alepha.inject(TestEntityRepositories);
    rows = alepha.inject(MonitorRows);
    persistence = alepha.inject(AutomationPersistence);
    time = alepha.inject(DateTimeProvider);
    await alepha.start();
    time.pause();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "ship", options: { uptime: true } }],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("runs a rule for a confirmed outage and for its recovery, once each", async ({
    expect,
  }) => {
    const monitor = await seed();
    const outage = await rule("monitor.down");
    const recovery = await rule("monitor.up");

    // One failed probe out of two confirmations: no incident, no event.
    expect(await probe(monitor.id, down)).toEqual([]);
    expect(await persistence.events.count({ projectId: project.id })).toBe(0);
    expect(await dispatch(outage.id)).toBe(0);

    const opened = await probe(monitor.id, down);
    expect(opened.map((it) => it.kind)).toEqual(["opened"]);
    const [event] = await persistence.events.findMany({
      where: { projectId: project.id, name: "monitor.down" },
    });
    expect(event.identity).toBe(`monitor:${opened[0].incident.id}:down`);
    expect(event.payload.fields).toMatchObject({
      monitor_id: monitor.id,
      monitor: "Website",
      kind: "http",
      // No userinfo, no query, no fragment.
      target: "https://example.test/health",
      cause: "connection",
      // One line.
      error: "Connection refused",
    });
    expect(await dispatch(outage.id)).toBe(1);
    expect(await dispatch(recovery.id)).toBe(0);

    // Still down: the incident stays open, nothing more is recorded.
    expect(await probe(monitor.id, down)).toEqual([]);
    expect(await dispatch(outage.id)).toBe(0);

    const closed = await probe(monitor.id, up);
    expect(closed.map((it) => it.kind)).toEqual(["closed"]);
    const recovered = await persistence.events.getOne({
      where: { projectId: project.id, name: "monitor.up" },
    });
    expect(recovered.identity).toBe(`monitor:${closed[0].incident.id}:up`);
    expect(recovered.payload.fields).toMatchObject({
      monitor_id: monitor.id,
      ended_at: closed[0].incident.endedAt,
    });
    expect(recovered.payload.fields.duration_secs).toBeGreaterThan(0);
    expect(await dispatch(recovery.id)).toBe(1);
    expect(await dispatch(outage.id)).toBe(0);
    expect(await persistence.events.count({ projectId: project.id })).toBe(2);
  });

  it("filters on the trigger's monitor", async ({ expect }) => {
    const watched = await seed("Website");
    const other = await seed("API");
    const only = await rule("monitor.down", watched.id);

    await probe(other.id, down);
    await probe(other.id, down);
    expect(await dispatch(only.id)).toBe(0);

    await probe(watched.id, down);
    await probe(watched.id, down);
    expect(await dispatch(only.id)).toBe(1);
  });

  it("refuses a monitor filter that names another project's monitor", async ({
    expect,
  }) => {
    const elsewhere = await createTestProject(alepha, {
      capabilities: [{ key: "ship", options: { uptime: true } }],
    });
    const foreign = await rows.monitors.create({
      projectId: elsewhere.id,
      name: "Foreign",
      kind: "http",
      target: "https://foreign.test",
      confirmations: 1,
      statusSince: time.nowISOString(),
      nextCheckAt: time.nowISOString(),
    });
    await expect(rule("monitor.down", foreign.id)).rejects.toThrow(
      "Monitor does not exist",
    );
  });
});
