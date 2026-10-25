import { createTestProject } from "@lore/core/testing";
import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { AlephaServer, ServerProvider } from "alepha/server";
import { afterEach, describe, it } from "vitest";

import { UptimePushController } from "../src/api/controllers/UptimePushController.ts";
import { monitorIncidents } from "../src/api/entities/monitorIncidents.ts";
import { monitors } from "../src/api/entities/monitors.ts";
import { LoreDeployApi } from "../src/api/index.ts";
import { UptimePushService } from "../src/api/services/UptimePushService.ts";
import { DeployTestEntities } from "../src/testing/entities.ts";

class Repositories extends DeployTestEntities {
  monitors = $repository(monitors);
  incidents = $repository(monitorIncidents);
}

describe("Push monitor receipts", () => {
  const containers: Alepha[] = [];
  afterEach(async () => {
    for (const alepha of containers.splice(0)) await alepha.stop();
  });
  const setup = async () => {
    const alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        DATABASE_TRANSACTIONS: false,
        LOG_LEVEL: "error",
        SERVER_PORT: 0,
        SERVER_HOST: "127.0.0.1",
      },
    })
      .with(AlephaServer)
      .with(LoreDeployApi);
    const repos = alepha.inject(Repositories);
    const clock = alepha.inject(DateTimeProvider);
    clock.pause();
    await alepha.start();
    containers.push(alepha);
    const project = await createTestProject(alepha, {
      capabilities: [{ key: "apps", options: { uptime: true } }],
    });
    const created = await alepha.inject(UptimePushService).create(project.id, {
      name: "Backup",
      intervalSecs: 60,
      timeoutSecs: 10,
      confirmations: 2,
      expect: {},
    });
    const push = (token: string) =>
      fetch(`${alepha.inject(ServerProvider).hostname}/uptime/push/${token}`);
    return { alepha, repos, clock, project, created, push };
  };

  it("stores a hash, accepts a receipt without a session and refuses an unknown token", async ({
    expect,
  }) => {
    const ctx = await setup();
    expect(ctx.created.monitor.pushTokenHash).not.toBe(ctx.created.token);
    expect(JSON.stringify(ctx.created.monitor)).not.toContain(
      ctx.created.token,
    );
    const accepted = await ctx.push(ctx.created.token);
    expect(accepted.status).toBe(204);
    expect(accepted.headers.get("cache-control")).toContain("no-store");
    const row = await ctx.repos.monitors.getById(ctx.created.monitor.id);
    expect(row.lastPushedAt).toBe(ctx.clock.nowISOString());
    expect(row.lastCheckedAt).toBe(row.lastPushedAt);
    expect(row.failures).toBe(0);
    expect((await ctx.push(`up_${"x".repeat(32)}`)).status).toBe(404);
  });

  it("detects silence despite ongoing ticks, recovers on a new push and rotates without deleting history", async ({
    expect,
  }) => {
    const ctx = await setup();
    const id = ctx.created.monitor.id;
    const read = () => ctx.repos.monitors.getById(id);
    expect((await ctx.push(ctx.created.token)).status).toBe(204);
    for (let index = 0; index < 4; index++) {
      const previous = (await read()).lastCheckedAt;
      await ctx.clock.travel(1, "minute");
      await expect
        .poll(async () => (await read()).lastCheckedAt)
        .not.toBe(previous);
    }
    expect((await read()).status).toBe("down");
    await expect.poll(() => ctx.repos.incidents.count()).toBe(1);
    expect((await ctx.push(ctx.created.token)).status).toBe(204);
    await ctx.clock.travel(1, "minute");
    await expect.poll(async () => (await read()).status).toBe("up");
    const incident = (await ctx.repos.incidents.findMany())[0]!;
    await expect
      .poll(
        async () => (await ctx.repos.incidents.getById(incident.id)).endedAt,
      )
      .toBeDefined();
    const rotated = await ctx.alepha
      .inject(UptimePushController)
      .rotateMonitorPushToken.fetch(
        { params: { monitorId: id } },
        { user: { id: ctx.project.createdBy, roles: ["user"] } },
      );
    expect(rotated.data.token).not.toBe(ctx.created.token);
    expect((await ctx.push(ctx.created.token)).status).toBe(404);
    expect((await ctx.push(rotated.data.token)).status).toBe(204);
    expect(await ctx.repos.incidents.count()).toBe(1);
  });
  it("never recovers a monitor that has never received a push", async ({
    expect,
  }) => {
    const ctx = await setup();
    const id = ctx.created.monitor.id;
    for (let index = 0; index < 5; index++) {
      const previous = (await ctx.repos.monitors.getById(id)).lastCheckedAt;
      await ctx.clock.travel(1, "minute");
      await expect
        .poll(async () => (await ctx.repos.monitors.getById(id)).lastCheckedAt)
        .not.toBe(previous);
    }
    expect((await ctx.repos.monitors.getById(id)).status).toBe("down");
    const incidents = await ctx.repos.incidents.findMany();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.endedAt).toBeUndefined();
  });
  it("checks a long push silence window every minute rather than waiting another whole window", async ({
    expect,
  }) => {
    const ctx = await setup();
    const id = ctx.created.monitor.id;
    await ctx.repos.monitors.updateById(id, { intervalSecs: 3600 });
    expect((await ctx.push(ctx.created.token)).status).toBe(204);
    await ctx.clock.travel(60, "minutes");
    await expect
      .poll(async () => (await ctx.repos.monitors.getById(id)).lastCheckedAt)
      .toBeDefined();
    for (let index = 0; index < 2; index++) {
      const previous = (await ctx.repos.monitors.getById(id)).lastCheckedAt;
      await ctx.clock.travel(1, "minute");
      await expect
        .poll(async () => (await ctx.repos.monitors.getById(id)).lastCheckedAt)
        .not.toBe(previous);
    }
    expect((await ctx.repos.monitors.getById(id)).status).toBe("down");
  });
});
