import { createTestProject } from "@lore/core/testing";
import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { afterEach, describe, it } from "vitest";

import { MonitorController } from "../src/api/controllers/MonitorController.ts";
import { DeployAnalytics } from "../src/api/entities/deployAnalytics.ts";
import { monitorHeartbeats } from "../src/api/entities/monitorHeartbeats.ts";
import { monitors } from "../src/api/entities/monitors.ts";
import { LoreDeployApi } from "../src/api/index.ts";
import { DeployTestEntities } from "../src/testing/entities.ts";

class Repositories extends DeployTestEntities {
  monitors = $repository(monitors);
  beats = $repository(monitorHeartbeats);
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
  const setup = async () => {
    const alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        LOG_LEVEL: "error",
        DATABASE_TRANSACTIONS: false,
      },
    }).with(LoreDeployApi);
    const repos = alepha.inject(Repositories);
    const clock = alepha.inject(DateTimeProvider);
    clock.pause();
    await alepha.start();
    containers.push(alepha);
    const project = await createTestProject(alepha, {
      capabilities: [{ key: "apps", options: { uptime: true } }],
    });
    return {
      alepha,
      repos,
      clock,
      project,
      api: alepha.inject(MonitorController),
      user: { id: project.createdBy, roles: ["user"] },
    };
  };

  it("creates, edits, pauses, resumes and deletes without a sigil", async ({
    expect,
  }) => {
    const ctx = await setup();
    const created = await ctx.api.createMonitor.fetch(
      { params: { projectId: ctx.project.id }, body: config },
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
      { params: { projectId: ctx.project.id }, body: config },
      { user: ctx.user },
    );
    const push = await ctx.api.createMonitor.fetch(
      {
        params: { projectId: ctx.project.id },
        body: { ...config, name: "Backup", kind: "push", target: "" },
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

  it("validates targets and refuses disabled features and another project's monitor", async ({
    expect,
  }) => {
    const ctx = await setup();
    await expect(
      ctx.api.createMonitor.fetch(
        {
          params: { projectId: ctx.project.id },
          body: { ...config, target: "ftp://example.test" },
        },
        { user: ctx.user },
      ),
    ).rejects.toThrow();
    const created = await ctx.api.createMonitor.fetch(
      { params: { projectId: ctx.project.id }, body: config },
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
      capabilities: [{ key: "apps", options: { uptime: false } }],
    });
    await expect(
      ctx.api.createMonitor.fetch(
        { params: { projectId: off.id }, body: config },
        { user: { id: off.createdBy, roles: ["user"] } },
      ),
    ).rejects.toThrow();
  });
});
