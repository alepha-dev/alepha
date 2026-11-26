import { createTestProject } from "@lore/core/testing";
import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { afterEach, describe, it } from "vitest";

import { AppController } from "../src/api/controllers/AppController.ts";
import { MonitorController } from "../src/api/controllers/MonitorController.ts";
import { appInstances } from "../src/api/entities/appInstances.ts";
import { DeployAnalytics } from "../src/api/entities/deployAnalytics.ts";
import { monitorHeartbeats } from "../src/api/entities/monitorHeartbeats.ts";
import { monitorIncidents } from "../src/api/entities/monitorIncidents.ts";
import { monitors } from "../src/api/entities/monitors.ts";
import { LoreShipApi } from "../src/api/index.ts";
import { UptimeSocketProber } from "../src/api/services/UptimeSocketProber.ts";
import { DeployTestEntities } from "../src/testing/entities.ts";

/** A runtime without sockets, as on Workers. */
class NoSocketsProber extends UptimeSocketProber {
  protected override supportsSockets(): boolean {
    return false;
  }
}

class Repositories extends DeployTestEntities {
  monitors = $repository(monitors);
  beats = $repository(monitorHeartbeats);
  incidents = $repository(monitorIncidents);
  instances = $repository(appInstances);
}

const config = {
  name: "Website",
  kind: "http" as const,
  target: "https://example.test",
  intervalSecs: 60,
  timeoutSecs: 10,
  confirmations: 2,
  expect: {},
};

describe("Monitor API", () => {
  const containers: Alepha[] = [];
  afterEach(async () => {
    for (const alepha of containers.splice(0)) await alepha.stop();
  });
  const setup = async (options: { sockets?: boolean } = {}) => {
    const alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        LOG_LEVEL: "error",
        DATABASE_TRANSACTIONS: false,
      },
    });
    if (options.sockets === false)
      alepha.with({ provide: UptimeSocketProber, use: NoSocketsProber });
    alepha.with(LoreShipApi);
    const repos = alepha.inject(Repositories);
    const clock = alepha.inject(DateTimeProvider);
    clock.pause();
    await alepha.start();
    containers.push(alepha);
    const project = await createTestProject(alepha, {
      capabilities: [{ key: "ship", options: { uptime: true } }],
    });
    // A monitor belongs to an app copy (#Q3657); this one has no deploy and
    // no sigil, only an address.
    const app = await repos.instances.create({
      projectId: project.id,
      app: "website",
      env: "production",
      url: "https://example.test",
    });
    return {
      alepha,
      repos,
      clock,
      project,
      app,
      body: { ...config, appInstanceId: app.id },
      api: alepha.inject(MonitorController),
      user: { id: project.createdBy, roles: ["user"] },
    };
  };

  it("creates, edits, pauses, resumes and deletes without a sigil", async ({
    expect,
  }) => {
    const ctx = await setup();
    const created = await ctx.api.createMonitor.fetch(
      { params: { projectId: ctx.project.id }, body: ctx.body },
      { user: ctx.user },
    );
    const id = created.data.monitor.id;
    expect(created.data.monitor.status).toBe("pending");
    const edited = await ctx.api.updateMonitor.fetch(
      { params: { monitorId: id }, body: { ...config, name: "Renamed" } },
      { user: ctx.user },
    );
    expect(edited.data.name).toBe("Renamed");
    const paused = await ctx.api.setMonitorActive.fetch(
      { params: { monitorId: id }, body: { active: false } },
      { user: ctx.user },
    );
    expect(paused.data.status).toBe("paused");
    const resumed = await ctx.api.setMonitorActive.fetch(
      { params: { monitorId: id }, body: { active: true } },
      { user: ctx.user },
    );
    expect(resumed.data.status).toBe("pending");
    await ctx.api.deleteMonitor.fetch(
      { params: { monitorId: id } },
      { user: ctx.user },
    );
    expect(await ctx.repos.monitors.count()).toBe(0);
  });

  it("returns down first, exact window ratios and only the last 50 beats without credentials", async ({
    expect,
  }) => {
    const ctx = await setup();
    const first = await ctx.api.createMonitor.fetch(
      { params: { projectId: ctx.project.id }, body: ctx.body },
      { user: ctx.user },
    );
    const push = await ctx.api.createMonitor.fetch(
      {
        params: { projectId: ctx.project.id },
        body: { ...ctx.body, name: "Backup", kind: "push", target: "" },
      },
      { user: ctx.user },
    );
    expect(push.data.token).toBeTruthy();
    expect(JSON.stringify(push.data.monitor)).not.toContain("pushTokenHash");
    const down = await ctx.repos.monitors.getById(push.data.monitor.id);
    down.status = "down";
    await ctx.repos.monitors.save(down);
    const id = first.data.monitor.id;
    for (let index = 0; index < 60; index++)
      await ctx.repos.beats.create({
        monitorId: id,
        at: new Date(ctx.clock.nowMillis() - (60 - index) * 1000).toISOString(),
        ok: index % 2 === 0,
        latencyMs: index,
      });
    await ctx.alepha.inject(DeployAnalytics).probes.record({
      monitorId: id,
      count: 4,
      up: 3,
      latencyMs: 60,
      hour: ctx.clock.nowISOString().slice(0, 13),
    });
    const listed = await ctx.api.listMonitors.fetch(
      { params: { projectId: ctx.project.id }, query: { window: "24h" } },
      { user: ctx.user },
    );
    expect(listed.data.items[0]?.name).toBe("Backup");
    const website = listed.data.items.find((row) => row.id === id)!;
    expect(website.uptimePct).toBe(75);
    expect(website.beats).toHaveLength(50);
    expect(website.beats[0]?.latencyMs).toBe(10);
    expect(listed.data.estimated).toBe(false);
    expect(JSON.stringify(listed.data)).not.toContain(push.data.token!);
    expect(JSON.stringify(listed.data)).not.toContain("pushTokenHash");
  });

  it("reads exact window ratios, successful latency means, gap buckets and incident durations", async ({
    expect,
  }) => {
    const ctx = await setup();
    const created = await ctx.api.createMonitor.fetch(
      { params: { projectId: ctx.project.id }, body: ctx.body },
      { user: ctx.user },
    );
    const monitorId = created.data.monitor.id;
    const now = ctx.clock.nowMillis();
    const hour = new Date(now).toISOString().slice(0, 13);
    const analytics = ctx.alepha.inject(DeployAnalytics);
    await analytics.probes.record({
      monitorId,
      hour,
      count: 4,
      up: 3,
      latencyMs: 360,
    });
    await analytics.probes.record({
      monitorId,
      hour: new Date(now - 48 * 3_600_000).toISOString().slice(0, 13),
      count: 6,
      up: 2,
      latencyMs: 400,
    });
    await ctx.repos.beats.create({
      monitorId,
      at: new Date(now).toISOString(),
      ok: true,
      latencyMs: 120,
    });
    await ctx.repos.incidents.create({
      monitorId,
      startedAt: new Date(now - 240_000).toISOString(),
      endedAt: new Date(now - 60_000).toISOString(),
      cause: "timeout",
      lastError: "Deadline exceeded",
    });
    const result = (
      await ctx.api.getMonitorDetail.fetch(
        { params: { monitorId }, query: { window: "24h" } },
        { user: ctx.user },
      )
    ).data;
    expect(result.estimated).toBe(false);
    expect(result.uptime.map((card) => card.uptimePct)).toEqual([75, 50, 50]);
    expect(result.points).toHaveLength(24);
    expect(result.points.at(-1)?.latencyMs).toBe(120);
    expect(result.points[0]?.latencyMs).toBeNull();
    expect(result.beats).toHaveLength(1);
    expect(result.incidents[0]?.durationSecs).toBe(180);
    expect(JSON.stringify(result)).not.toContain("pushTokenHash");
    const daily = (
      await ctx.api.getMonitorDetail.fetch(
        { params: { monitorId }, query: { window: "7d" } },
        { user: ctx.user },
      )
    ).data;
    expect(daily.points).toHaveLength(7);
    expect(daily.points.at(-1)?.latencyMs).toBe(120);
    expect(daily.points.at(-3)?.latencyMs).toBe(200);
    const stranger = await createTestProject(ctx.alepha);
    await expect(
      ctx.api.getMonitorDetail.fetch(
        { params: { monitorId }, query: { window: "24h" } },
        { user: { id: stranger.createdBy, roles: ["user"] } },
      ),
    ).rejects.toThrow();
  });

  it("refuses tcp and cert monitors where the runtime has no sockets, and says so on the list", async ({
    expect,
  }) => {
    const ctx = await setup({ sockets: false });
    const reason =
      "TCP and certificate monitors require the self-hosted Node runtime with socket support";
    for (const [kind, target] of [
      ["tcp", "db.example.test:5432"],
      ["cert", "example.test"],
    ] as const) {
      await expect(
        ctx.api.createMonitor.fetch(
          {
            params: { projectId: ctx.project.id },
            body: { ...ctx.body, kind, target },
          },
          { user: ctx.user },
        ),
      ).rejects.toThrow(reason);
    }
    expect(await ctx.repos.monitors.count()).toBe(0);
    // One made before the refusal cannot be saved or resumed, only paused or deleted.
    const now = ctx.clock.nowISOString();
    const older = await ctx.repos.monitors.create({
      projectId: ctx.project.id,
      appInstanceId: ctx.app.id,
      name: "Database",
      kind: "tcp",
      target: "db.example.test:5432",
      statusSince: now,
      nextCheckAt: now,
    });
    await expect(
      ctx.api.updateMonitor.fetch(
        {
          params: { monitorId: older.id },
          body: { ...config, kind: "tcp", target: "db.example.test:5433" },
        },
        { user: ctx.user },
      ),
    ).rejects.toThrow(reason);
    const paused = await ctx.api.setMonitorActive.fetch(
      { params: { monitorId: older.id }, body: { active: false } },
      { user: ctx.user },
    );
    expect(paused.data.status).toBe("paused");
    await expect(
      ctx.api.setMonitorActive.fetch(
        { params: { monitorId: older.id }, body: { active: true } },
        { user: ctx.user },
      ),
    ).rejects.toThrow(reason);
    // HTTP still works, and the list tells the form what this Lore can run.
    await ctx.api.createMonitor.fetch(
      { params: { projectId: ctx.project.id }, body: ctx.body },
      { user: ctx.user },
    );
    const listed = await ctx.api.listMonitors.fetch(
      { params: { projectId: ctx.project.id }, query: { window: "24h" } },
      { user: ctx.user },
    );
    expect(listed.data.sockets).toBe(false);
    expect(listed.data.items).toHaveLength(2);

    const node = await setup();
    const created = await node.api.createMonitor.fetch(
      {
        params: { projectId: node.project.id },
        body: { ...node.body, kind: "cert", target: "example.test" },
      },
      { user: node.user },
    );
    expect(created.data.monitor.kind).toBe("cert");
    const onNode = await node.api.listMonitors.fetch(
      { params: { projectId: node.project.id }, query: { window: "24h" } },
      { user: node.user },
    );
    expect(onNode.data.sockets).toBe(true);
  });

  it("validates targets and refuses disabled features and another project's monitor", async ({
    expect,
  }) => {
    const ctx = await setup();
    await expect(
      ctx.api.createMonitor.fetch(
        {
          params: { projectId: ctx.project.id },
          body: { ...ctx.body, target: "ftp://example.test" },
        },
        { user: ctx.user },
      ),
    ).rejects.toThrow();
    const created = await ctx.api.createMonitor.fetch(
      { params: { projectId: ctx.project.id }, body: ctx.body },
      { user: ctx.user },
    );
    const stranger = await createTestProject(ctx.alepha);
    await expect(
      ctx.api.updateMonitor.fetch(
        { params: { monitorId: created.data.monitor.id }, body: config },
        { user: { id: stranger.createdBy, roles: ["user"] } },
      ),
    ).rejects.toThrow();
    const off = await createTestProject(ctx.alepha, {
      capabilities: [{ key: "ship", options: { uptime: false } }],
    });
    await expect(
      ctx.api.createMonitor.fetch(
        { params: { projectId: off.id }, body: ctx.body },
        { user: { id: off.createdBy, roles: ["user"] } },
      ),
    ).rejects.toThrow();
  });
  it("belongs to an app copy: refuses none, and refuses another project's", async ({
    expect,
  }) => {
    const ctx = await setup();
    await expect(
      ctx.api.createMonitor.fetch(
        // biome-ignore lint/suspicious/noExplicitAny: the missing owner is the point
        { params: { projectId: ctx.project.id }, body: config as any },
        { user: ctx.user },
      ),
    ).rejects.toThrow();
    const stranger = await createTestProject(ctx.alepha, {
      capabilities: [{ key: "ship", options: { uptime: true } }],
    });
    const theirs = await ctx.repos.instances.create({
      projectId: stranger.id,
      app: "theirs",
      env: "production",
    });
    await expect(
      ctx.api.createMonitor.fetch(
        {
          params: { projectId: ctx.project.id },
          body: { ...config, appInstanceId: theirs.id },
        },
        { user: ctx.user },
      ),
    ).rejects.toThrow("App not found in this project");
    const created = await ctx.api.createMonitor.fetch(
      { params: { projectId: ctx.project.id }, body: ctx.body },
      { user: ctx.user },
    );
    expect(created.data.monitor.appInstanceId).toBe(ctx.app.id);
    // Deleting the app deletes its monitor.
    await ctx.repos.instances.deleteById(ctx.app.id);
    expect(await ctx.repos.monitors.count()).toBe(0);
  });

  it("gives a monitor made before the link an owner: the copy at its address, or an app made for it", async ({
    expect,
  }) => {
    const ctx = await setup();
    const now = ctx.clock.nowISOString();
    const orphan = (name: string, target: string, kind = "http" as const) =>
      ctx.repos.monitors.create({
        projectId: ctx.project.id,
        name,
        kind,
        target,
        statusSince: now,
        nextCheckAt: now,
      });
    const matched = await orphan("Site", "https://EXAMPLE.test/");
    const loose = await orphan("Status page!", "https://status.example.test");
    const tcp = await ctx.repos.monitors.create({
      projectId: ctx.project.id,
      name: "Website",
      kind: "tcp",
      target: "db.example.test:5432",
      statusSince: now,
      nextCheckAt: now,
    });

    const listed = await ctx.alepha
      .inject(AppController)
      .listApps.fetch(
        { params: { projectId: ctx.project.id } },
        { user: ctx.user },
      );

    const byId = async (id: string) =>
      (await ctx.repos.monitors.getById(id)).appInstanceId;
    expect(await byId(matched.id)).toBe(ctx.app.id);
    const made = listed.data.items.find((item) => item.app === "status-page");
    expect(made?.env).toBe("production");
    expect(made?.url).toBe("https://status.example.test");
    expect(await byId(loose.id)).toBe(made?.id);
    // A TCP check matches no address: it gets an app of its own, and the
    // name the copy already holds is not reused.
    const tcpOwner = listed.data.items.find((item) => item.app === "website-2");
    expect(await byId(tcp.id)).toBe(tcpOwner?.id);
    expect(tcpOwner?.url).toBeUndefined();

    // Read again, nothing moves.
    await ctx.api.listMonitors.fetch(
      { params: { projectId: ctx.project.id }, query: { window: "24h" } },
      { user: ctx.user },
    );
    expect(await ctx.repos.instances.count()).toBe(3);
  });
  it("follows the app's address, and refuses clearing it while Monitor is on", async ({
    expect,
  }) => {
    const ctx = await setup();
    const apps = ctx.alepha.inject(AppController);
    const created = await ctx.api.createMonitor.fetch(
      { params: { projectId: ctx.project.id }, body: ctx.body },
      { user: ctx.user },
    );
    const id = created.data.monitor.id;
    const patch = (url: string) =>
      apps.updateApp.fetch(
        {
          params: {
            projectId: ctx.project.id,
            app: "website",
            env: "production",
          },
          body: { url },
        },
        { user: ctx.user },
      );

    // A new address moves the check (#Q3684).
    await patch("https://www.example.test");
    expect((await ctx.repos.monitors.getById(id)).target).toBe(
      "https://www.example.test",
    );

    // Clearing it while on is refused, and nothing changes.
    await expect(patch("")).rejects.toThrow("Turn Monitor off");
    expect((await ctx.repos.instances.getById(ctx.app.id)).url).toBe(
      "https://www.example.test",
    );

    // Off: the address may go, and the paused check keeps its target.
    await ctx.api.setMonitorActive.fetch(
      { params: { monitorId: id }, body: { active: false } },
      { user: ctx.user },
    );
    await patch("");
    expect((await ctx.repos.instances.getById(ctx.app.id)).url).toBeUndefined();
    expect((await ctx.repos.monitors.getById(id)).target).toBe(
      "https://www.example.test",
    );
  });
});
