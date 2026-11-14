import { createTestProject } from "@lore/core/testing";
import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaMcp } from "alepha/mcp";
import { $repository } from "alepha/orm";
import { currentUserAtom } from "alepha/security";
import { afterEach, describe, it } from "vitest";

import { monitorHeartbeats } from "../src/api/entities/monitorHeartbeats.ts";
import { monitorIncidents } from "../src/api/entities/monitorIncidents.ts";
import { monitors } from "../src/api/entities/monitors.ts";
import { LoreShipApi } from "../src/api/index.ts";
import { LoreShipMcp, MonitorTools } from "../src/mcp/index.ts";
import { DeployTestEntities } from "../src/testing/entities.ts";

/**
 * Extends the fixtures `createTestProject` reads, so they are registered
 * before the container starts and locks.
 */
class Repositories extends DeployTestEntities {
  monitors = $repository(monitors);
  beats = $repository(monitorHeartbeats);
  incidents = $repository(monitorIncidents);
}

type ToolName = Exclude<keyof MonitorTools, "monitors" | "projects" | "merge">;

/**
 * The `monitor_*` tools (#Q3591): one per `lore monitor` verb, over
 * `MonitorController`, so a monitor is read and written with the page's
 * permissions and never shows its push token after creation.
 */
describe("monitor MCP tools", () => {
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
    })
      .with(AlephaMcp)
      .with(LoreShipApi)
      .with(LoreShipMcp);
    const repos = alepha.inject(Repositories);
    // Injected before start: a started container is locked.
    const tools = alepha.inject(MonitorTools);
    const clock = alepha.inject(DateTimeProvider);
    clock.pause();
    await alepha.start();
    containers.push(alepha);
    const project = await createTestProject(alepha, {
      capabilities: [{ key: "ship", options: { uptime: true } }],
    });
    const user = { id: project.createdBy, roles: ["user"] };
    const call = (
      name: ToolName,
      params: Record<string, unknown>,
      as: { id: string; roles: string[] } = user,
    ) =>
      alepha.context.run(() => {
        alepha.store.set(currentUserAtom, as);
        return (
          tools[name] as unknown as {
            execute: (p: unknown) => Promise<any>;
          }
        ).execute(params);
      });
    return { alepha, repos, clock, project, call };
  };

  it("creates, lists, reads, updates, pauses, resumes and deletes a monitor", async ({
    expect,
  }) => {
    const ctx = await setup();

    const created = await ctx.call("monitor_create", {
      project: ctx.project.id,
      name: "Website",
      kind: "http",
      target: "https://example.app",
      expect: { status: 200, keyword: "ok" },
    });
    const id = created.monitor.id;
    expect(created.monitor.status).toBe("pending");
    expect(created.token).toBeUndefined();

    const listed = await ctx.call("monitor_list", { project: ctx.project.id });
    expect(listed.window).toBe("24h");
    expect(listed.monitors).toHaveLength(1);
    expect(listed.monitors[0]).toMatchObject({
      id,
      name: "Website",
      uptimePct: null,
    });
    expect(listed.monitors[0]).not.toHaveProperty("beats");

    // Only the fields passed change: the target and `expect` survive a rename.
    const renamed = await ctx.call("monitor_update", {
      monitor_id: id,
      name: "Homepage",
      interval_secs: 300,
    });
    expect(renamed).toMatchObject({
      name: "Homepage",
      target: "https://example.app",
      intervalSecs: 300,
      expect: { status: 200, keyword: "ok" },
    });

    const paused = await ctx.call("monitor_pause", { monitor_id: id });
    expect(paused.status).toBe("paused");
    const resumed = await ctx.call("monitor_resume", { monitor_id: id });
    expect(resumed.status).toBe("pending");

    expect(await ctx.call("monitor_delete", { monitor_id: id })).toEqual({
      ok: true,
    });
    expect(await ctx.repos.monitors.count()).toBe(0);
  });

  it("reads a monitor's uptime, incidents and its last ten checks only", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { monitor } = await ctx.call("monitor_create", {
      project_name: ctx.project.title,
      name: "Api",
      kind: "tcp",
      target: "example.app:443",
    });
    const now = ctx.clock.nowMillis();
    for (let index = 0; index < 15; index++) {
      await ctx.repos.beats.create({
        monitorId: monitor.id,
        at: new Date(now - (15 - index) * 60_000).toISOString(),
        ok: index !== 14,
        latencyMs: index,
        ...(index === 14 ? { error: "connection refused" } : {}),
      });
    }
    await ctx.repos.incidents.create({
      monitorId: monitor.id,
      startedAt: new Date(now - 120_000).toISOString(),
      cause: "connection",
      lastError: "connection refused",
    });

    const detail = await ctx.call("monitor_get", { monitor_id: monitor.id });

    expect(detail.monitor.name).toBe("Api");
    expect(
      detail.uptime.map((card: { window: string }) => card.window),
    ).toEqual(["24h", "7d", "30d"]);
    expect(detail.incidents).toHaveLength(1);
    expect(detail.incidents[0].cause).toBe("connection");
    expect(detail.recentChecks).toHaveLength(10);
    expect(detail.recentChecks.at(-1)).toMatchObject({
      ok: false,
      error: "connection refused",
    });
    expect(detail).not.toHaveProperty("points");
  });

  it("shows a push monitor's token once, and never again", async ({
    expect,
  }) => {
    const ctx = await setup();

    const created = await ctx.call("monitor_create", {
      project: ctx.project.id,
      name: "Nightly backup",
      kind: "push",
      target: "",
      interval_secs: 86_400,
    });
    expect(created.token).toBeTruthy();

    const listed = await ctx.call("monitor_list", { project: ctx.project.id });
    const read = await ctx.call("monitor_get", {
      monitor_id: created.monitor.id,
    });
    for (const answer of [listed, read]) {
      expect(JSON.stringify(answer)).not.toContain(created.token);
      expect(JSON.stringify(answer)).not.toContain("pushTokenHash");
    }
  });

  it("refuses another project's monitors and a project without Healthchecks", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { monitor } = await ctx.call("monitor_create", {
      project: ctx.project.id,
      name: "Website",
      kind: "http",
      target: "https://example.app",
    });
    const stranger = await createTestProject(ctx.alepha);
    const outsider = { id: stranger.createdBy, roles: ["user"] };

    await expect(
      ctx.call("monitor_list", { project: ctx.project.id }, outsider),
    ).rejects.toThrow();
    await expect(
      ctx.call("monitor_get", { monitor_id: monitor.id }, outsider),
    ).rejects.toThrow();
    await expect(
      ctx.call("monitor_delete", { monitor_id: monitor.id }, outsider),
    ).rejects.toThrow();

    const off = await createTestProject(ctx.alepha, {
      capabilities: [{ key: "ship", options: { uptime: false } }],
    });
    await expect(
      ctx.call(
        "monitor_create",
        {
          project: off.id,
          name: "Website",
          kind: "http",
          target: "https://example.app",
        },
        { id: off.createdBy, roles: ["user"] },
      ),
    ).rejects.toThrow();
    expect(await ctx.repos.monitors.count()).toBe(1);
  });
});
