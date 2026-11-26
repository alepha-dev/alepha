import { hostInventories } from "@lore/core/schemas";
import { createTestProject } from "@lore/core/testing";
import { createTestHost } from "@lore/core/testing/hosts";
import { Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { afterEach, describe, it } from "vitest";

import { DeployAnalytics } from "../src/api/entities/deployAnalytics.ts";
import { monitorHeartbeats } from "../src/api/entities/monitorHeartbeats.ts";
import {
  type MonitorIncident,
  monitorIncidents,
} from "../src/api/entities/monitorIncidents.ts";
import { type Monitor, monitors } from "../src/api/entities/monitors.ts";
import { projectErrors } from "../src/api/entities/projectErrors.ts";
import { LoreShipApi } from "../src/api/index.ts";
import type { ProbeResult } from "../src/api/schemas/probeResultSchema.ts";
import { UptimeErrorService } from "../src/api/services/UptimeErrorService.ts";
import { UptimeProber } from "../src/api/services/UptimeProber.ts";
import { UptimeStateService } from "../src/api/services/UptimeStateService.ts";
import { DeployTestEntities } from "../src/testing/entities.ts";
import { UptimeTickWatch } from "../src/testing/UptimeTickWatch.ts";

class Repositories extends DeployTestEntities {
  projectErrors = $repository(projectErrors);
  monitors = $repository(monitors);
  incidents = $repository(monitorIncidents);
  beats = $repository(monitorHeartbeats);
  inventories = $repository(hostInventories);
}

class MemoryProber extends UptimeProber {
  plans = new Map<string, ProbeResult[]>();
  active = 0;
  maximumActive = 0;
  public override async probe(monitor: Monitor): Promise<ProbeResult> {
    this.active++;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return (
        this.plans.get(monitor.id)?.shift() ?? {
          ok: true,
          result: "up",
          latencyMs: 20,
        }
      );
    } finally {
      this.active--;
    }
  }
}

class FailingIncidentState extends UptimeStateService {
  protected first = true;
  protected override async createIncident(monitor: Monitor) {
    if (this.first) {
      this.first = false;
      throw new AlephaError("Injected incident write failure");
    }
    return super.createIncident(monitor);
  }
}

class RecordingState extends UptimeStateService {
  seen: Array<[string, MonitorIncident | null | undefined]> = [];
  public override async apply(
    monitor: Monitor,
    result: ProbeResult,
    checkedAt: number,
    open?: MonitorIncident | null,
  ) {
    this.seen.push([monitor.id, open]);
    return super.apply(monitor, result, checkedAt, open);
  }
}

describe("The uptime tick and state machine", () => {
  const containers: Alepha[] = [];
  afterEach(async () => {
    for (const alepha of containers.splice(0)) await alepha.stop();
  });
  const setup = async (failIncident = false, record = false) => {
    const alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        DATABASE_TRANSACTIONS: false,
        LOG_LEVEL: "error",
      },
    }).with({ provide: UptimeProber, use: MemoryProber });
    if (failIncident)
      alepha.with({ provide: UptimeStateService, use: FailingIncidentState });
    if (record)
      alepha.with({ provide: UptimeStateService, use: RecordingState });
    alepha.with(LoreShipApi);
    const repos = alepha.inject(Repositories);
    const clock = alepha.inject(DateTimeProvider);
    clock.pause();
    UptimeTickWatch.attach(alepha);
    await alepha.start();
    containers.push(alepha);
    const project = await createTestProject(alepha, {
      capabilities: [{ key: "ship", options: { uptime: true } }],
    });
    const seed = (
      name = "Website",
      confirmations = 2,
      projectId = project.id,
    ) =>
      repos.monitors.create({
        projectId,
        name,
        kind: "http",
        target: "https://example.test",
        confirmations,
        statusSince: clock.nowISOString(),
        nextCheckAt: clock.nowISOString(),
      });
    return {
      alepha,
      repos,
      clock,
      project,
      seed,
      prober: alepha.inject(MemoryProber),
    };
  };
  const up: ProbeResult = { ok: true, result: "up", latencyMs: 20 };
  const down: ProbeResult = {
    ok: false,
    result: "connection",
    latencyMs: 10,
    error: "Connection refused",
  };

  it("deduplicates flapping outages, resolves recovery and tolerates a purged error", async ({
    expect,
  }) => {
    const ctx = await setup();
    const monitor = await ctx.seed("Website", 1);
    const advance = async () => {
      const before = (await ctx.repos.monitors.getById(monitor.id))
        .lastCheckedAt;
      await ctx.clock.travel(1, "minute");
      await expect
        .poll(
          async () =>
            (await ctx.repos.monitors.getById(monitor.id)).lastCheckedAt,
          UptimeTickWatch.poll,
        )
        .not.toBe(before);
      await UptimeTickWatch.settled(ctx.clock);
    };
    ctx.prober.plans.set(monitor.id, [
      {
        ok: false,
        result: "timeout",
        latencyMs: 1000,
        error: "Probe deadline",
      },
      { ok: false, result: "timeout", latencyMs: 1000 },
      { ok: true, result: "up", latencyMs: 20 },
      { ok: false, result: "connection", latencyMs: 0, error: "Refused" },
      { ok: true, result: "up", latencyMs: 20 },
    ]);
    await advance();
    await expect.poll(() => ctx.repos.projectErrors.count()).toBe(1);
    const first = await ctx.repos.projectErrors.getOne({
      where: { projectId: ctx.project.id },
    });
    expect(first.status).toBe("open");
    expect(first.count).toBe(1);
    expect(first.stack).toContain(monitor.target);
    expect(first.stack).toContain("Failure: timeout");
    expect(first.stack).toContain("Probe deadline");
    const incident = await ctx.repos.incidents.getOne({
      where: { monitorId: monitor.id },
    });
    expect(first.stack).toContain(incident.startedAt);
    const effect = ctx.alepha.inject(UptimeErrorService);
    await effect.handle({ kind: "opened", monitor, incident });
    expect((await ctx.repos.projectErrors.getById(first.id)).count).toBe(1);
    await advance();
    expect(await ctx.repos.projectErrors.count()).toBe(1);
    expect((await ctx.repos.projectErrors.getById(first.id)).count).toBe(1);
    await advance();
    await expect
      .poll(
        async () => (await ctx.repos.projectErrors.getById(first.id)).status,
      )
      .toBe("resolved");
    await advance();
    expect(await ctx.repos.projectErrors.count()).toBe(1);
    await expect
      .poll(async () => (await ctx.repos.projectErrors.getById(first.id)).count)
      .toBe(2);
    const reopened = await ctx.repos.projectErrors.getById(first.id);
    expect(reopened.status).toBe("open");
    expect(reopened.count).toBe(2);
    expect(reopened.firstSeenAt).toBe(first.firstSeenAt);
    await ctx.repos.projectErrors.deleteById(first.id);
    await advance();
    expect(await ctx.repos.projectErrors.count()).toBe(0);
    const incidents = await ctx.repos.incidents.findMany({
      where: { monitorId: monitor.id },
    });
    expect(incidents).toHaveLength(2);
    expect(incidents.every((row) => row.endedAt)).toBe(true);
  });

  it("absorbs a blip, confirms an outage once, closes on recovery and writes every result", async ({
    expect,
  }) => {
    const ctx = await setup();
    const monitor = await ctx.seed();
    ctx.prober.plans.set(monitor.id, [up, down, up, down, down, down, up]);
    const row = () => ctx.repos.monitors.getById(monitor.id);
    const advance = async () => {
      const before = (await row()).lastCheckedAt;
      await ctx.clock.travel(1, "minute");
      await expect
        .poll(async () => (await row()).lastCheckedAt, UptimeTickWatch.poll)
        .not.toBe(before);
      await UptimeTickWatch.settled(ctx.clock);
      return row();
    };
    expect((await advance()).status).toBe("up");
    expect((await advance()).failures).toBe(1);
    expect(await ctx.repos.incidents.count()).toBe(0);
    expect((await advance()).failures).toBe(0);
    await advance();
    const failed = await advance();
    expect(failed.status).toBe("down");
    await expect.poll(() => ctx.repos.incidents.count()).toBe(1);
    const incident = (await ctx.repos.incidents.findMany())[0]!;
    expect(incident.startedAt).toBe(failed.statusSince);
    expect(incident.cause).toBe("connection");
    expect(incident.lastError).toBe("Connection refused");
    await advance();
    expect(await ctx.repos.incidents.count()).toBe(1);
    const recovered = await advance();
    expect(recovered.status).toBe("up");
    expect(recovered.lastError).toBeUndefined();
    await expect
      .poll(
        async () => (await ctx.repos.incidents.getById(incident.id)).endedAt,
      )
      .toBe(recovered.statusSince);
    expect(
      (Date.parse(recovered.nextCheckAt) - Date.parse(monitor.nextCheckAt)) %
        60_000,
    ).toBe(0);
    expect(await ctx.repos.beats.count()).toBe(7);
    const history = await ctx.alepha.inject(DeployAnalytics).probes.query({
      since: "2000-01-01",
      where: { monitorId: monitor.id },
      select: { count: "sum", up: "sum", latencyMs: "sum" },
    });
    expect(history.rows[0]).toMatchObject({ count: 7, up: 3, latencyMs: 60 });
  });

  it("bounds concurrency and ignores a project with uptime disabled", async ({
    expect,
  }) => {
    const ctx = await setup();
    for (let index = 0; index < 24; index++) await ctx.seed(`Website ${index}`);
    const disabled = await createTestProject(ctx.alepha, {
      capabilities: [{ key: "ship", options: { uptime: false } }],
    });
    const hidden = await ctx.seed("Disabled", 2, disabled.id);
    await ctx.clock.travel(1, "minute");
    await expect
      .poll(
        async () =>
          (
            await ctx.repos.monitors.findMany({
              where: { projectId: ctx.project.id, status: "up" },
            })
          ).length,
      )
      .toBe(24);
    expect(ctx.prober.maximumActive).toBeGreaterThan(1);
    expect(ctx.prober.maximumActive).toBeLessThanOrEqual(10);
    expect(
      (await ctx.repos.monitors.getById(hidden.id)).lastCheckedAt,
    ).toBeUndefined();
    expect(await ctx.repos.beats.count()).toBe(24);
  });

  it("hands each probe its open incident from one read and writes every result at the end of the tick", async ({
    expect,
  }) => {
    const ctx = await setup(false, true);
    const steady = await ctx.seed("Steady", 1);
    const failing = await ctx.seed("Failing", 1);
    ctx.prober.plans.set(failing.id, [down, down, up]);
    const state = ctx.alepha.inject(RecordingState);
    const tick = async () => {
      state.seen.length = 0;
      await ctx.clock.travel(1, "minute");
      await expect.poll(() => state.seen.length).toBe(2);
      await UptimeTickWatch.settled(ctx.clock);
      return new Map(state.seen);
    };
    const first = await tick();
    expect(first.get(steady.id)).toBeNull();
    expect(first.get(failing.id)).toBeNull();
    await expect.poll(() => ctx.repos.incidents.count()).toBe(1);
    const incident = (await ctx.repos.incidents.findMany())[0]!;
    const second = await tick();
    expect(second.get(steady.id)).toBeNull();
    expect(second.get(failing.id)?.id).toBe(incident.id);
    const third = await tick();
    expect(third.get(failing.id)?.id).toBe(incident.id);
    await expect
      .poll(
        async () => (await ctx.repos.incidents.getById(incident.id)).endedAt,
      )
      .toBeDefined();
    expect(await ctx.repos.beats.count()).toBe(6);
    const history = await ctx.alepha.inject(DeployAnalytics).probes.query({
      since: "2000-01-01",
      where: { monitorId: failing.id },
      select: { count: "sum", up: "sum" },
    });
    expect(history.rows[0]).toMatchObject({ count: 3, up: 1 });
  });

  it("does not overwrite a pause made while a probe was in flight", async ({
    expect,
  }) => {
    const ctx = await setup();
    const monitor = await ctx.seed();
    const stale = { ...monitor };
    monitor.active = false;
    monitor.status = "paused";
    await ctx.repos.monitors.save(monitor);
    await ctx.alepha
      .inject(UptimeStateService)
      .apply(stale, down, ctx.clock.nowMillis());
    expect((await ctx.repos.monitors.getById(monitor.id)).status).toBe(
      "paused",
    );
    expect(await ctx.repos.incidents.count()).toBe(0);
  });

  it("repairs a failed incident insert on the next tick without losing the original boundary", async ({
    expect,
  }) => {
    const ctx = await setup(true);
    const monitor = await ctx.seed("Repair", 1);
    ctx.prober.plans.set(monitor.id, [down, up]);
    await ctx.clock.travel(1, "minute");
    await expect
      .poll(async () => (await ctx.repos.monitors.getById(monitor.id)).status)
      .toBe("down");
    const failedAt = (await ctx.repos.monitors.getById(monitor.id)).statusSince;
    expect(await ctx.repos.incidents.count()).toBe(0);
    await ctx.clock.travel(1, "minute");
    await expect.poll(() => ctx.repos.incidents.count()).toBe(1);
    expect((await ctx.repos.incidents.findMany())[0]?.startedAt).toBe(failedAt);
    await expect
      .poll(async () => (await ctx.repos.incidents.findMany())[0]?.endedAt)
      .toBeDefined();
  });
  it("holds a failure while the named unit restarts, and counts it again past the grace", async ({
    expect,
  }) => {
    const ctx = await setup();
    const user = await ctx.repos.users.create({ email: "ops@example.com" });
    const host = await createTestHost(
      ctx.alepha,
      { id: user.id, roles: ["user"] },
      { slug: "api-box" },
    );
    const monitor = await ctx.repos.monitors.updateById(
      (await ctx.seed("API", 2, host.projectId)).id,
      { graceHost: "api-box", graceUnit: "api", graceSecs: 900 },
    );
    const state = ctx.alepha.inject(UptimeStateService);
    const since = ctx.clock.nowISOString();
    await ctx.repos.inventories.create({
      hostId: host.id,
      at: since,
      reportedAt: since,
      machine: {
        units: [{ name: "api.service", activeState: "activating", since }],
      },
      apps: [],
      appCount: 0,
    });

    // Restarting: three failures in a row are held, no outage opens.
    let current = monitor;
    for (let i = 0; i < 3; i++) {
      await state.apply(current, down, ctx.clock.nowMillis(), null);
      current = await ctx.repos.monitors.getById(monitor.id);
    }
    expect(current.failures).toBe(0);
    expect(current.status).not.toBe("down");
    expect(current.lastError).toContain("held: api.service is activating");
    expect(await ctx.repos.incidents.count()).toBe(0);

    // Past the grace the start is stuck: failures count again.
    await ctx.clock.travel(16, "minutes");
    await state.apply(current, down, ctx.clock.nowMillis(), null);
    current = await ctx.repos.monitors.getById(monitor.id);
    await state.apply(current, down, ctx.clock.nowMillis(), null);
    current = await ctx.repos.monitors.getById(monitor.id);
    expect(current.failures).toBe(2);
    expect(current.status).toBe("down");
  });
});
