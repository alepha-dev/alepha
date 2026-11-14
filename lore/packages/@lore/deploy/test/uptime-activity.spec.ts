import { ProjectController } from "@lore/core/api";
import { createTestProject } from "@lore/core/testing";
import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { afterEach, describe, it } from "vitest";

import { type Monitor, monitors } from "../src/api/entities/monitors.ts";
import { LoreDeployApi } from "../src/api/index.ts";
import { UptimeProber } from "../src/api/services/UptimeProber.ts";
import { DeployTestEntities } from "../src/testing/entities.ts";

class Repositories extends DeployTestEntities {
  monitors = $repository(monitors);
}

class MemoryProber extends UptimeProber {
  failing = false;
  public override async probe(_monitor: Monitor) {
    return this.failing
      ? {
          ok: false,
          result: "timeout" as const,
          latencyMs: 1000,
          error: "Deadline expired",
        }
      : { ok: true, result: "up" as const, latencyMs: 20 };
  }
}

/**
 * An uptime monitor's confirmed transitions land in the project's Activity
 * feed (#Q3596): `monitor:down` with the failure, `monitor:up` with the
 * outage's length, and nothing for a failed probe under the threshold.
 */
describe("Uptime transitions in the project's Activity", () => {
  const containers: Alepha[] = [];
  afterEach(async () => {
    for (const alepha of containers.splice(0)) await alepha.stop();
  });

  it("logs going down and recovering, and the Monitor filter shows them alone", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        DATABASE_TRANSACTIONS: false,
        LOG_LEVEL: "error",
      },
    })
      .with({ provide: UptimeProber, use: MemoryProber })
      .with(LoreDeployApi);
    const repos = alepha.inject(Repositories);
    const clock = alepha.inject(DateTimeProvider);
    clock.pause();
    await alepha.start();
    containers.push(alepha);
    const project = await createTestProject(alepha, {
      capabilities: [{ key: "apps", options: { uptime: true } }],
    });
    const user = { id: project.createdBy, roles: ["user"] };
    const prober = alepha.inject(MemoryProber);
    const monitor = await repos.monitors.create({
      projectId: project.id,
      name: "Status page",
      kind: "http",
      target: "https://status.example.test",
      confirmations: 2,
      statusSince: clock.nowISOString(),
      nextCheckAt: clock.nowISOString(),
    });
    const advance = async () => {
      const before = (await repos.monitors.getById(monitor.id)).lastCheckedAt;
      await clock.travel(1, "minute");
      await expect
        .poll(
          async () => (await repos.monitors.getById(monitor.id)).lastCheckedAt,
        )
        .not.toBe(before);
    };
    const activity = async (query: { type?: string; action?: string } = {}) =>
      (
        await alepha
          .inject(ProjectController)
          .getProjectActivity.fetch(
            { params: { id: project.id }, query },
            { user },
          )
      ).data.content;
    const monitorRows = async () => activity({ type: "monitor" });

    await advance();
    expect(await monitorRows()).toHaveLength(0);

    // One failed probe is under the threshold of two: not a change.
    prober.failing = true;
    await advance();
    expect((await repos.monitors.getById(monitor.id)).status).toBe("up");
    expect(await monitorRows()).toHaveLength(0);

    await advance();
    expect((await repos.monitors.getById(monitor.id)).status).toBe("down");
    await expect.poll(async () => (await monitorRows()).length).toBe(1);
    const [down] = await monitorRows();
    expect(down).toMatchObject({
      type: "monitor",
      action: "down",
      resourceId: monitor.id,
      description: "Status page",
    });
    expect(down?.metadata).toMatchObject({
      cause: "timeout",
      error: "Deadline expired",
    });

    // Further failed probes while it is down are not new transitions.
    await advance();
    await advance();
    expect(await monitorRows()).toHaveLength(1);

    prober.failing = false;
    await advance();
    await expect.poll(async () => (await monitorRows()).length).toBe(2);
    const up = (await activity({ type: "monitor", action: "up" }))[0];
    expect(up).toMatchObject({ action: "up", resourceId: monitor.id });
    // Down at the second failed probe, up three minutes later.
    expect(up?.metadata).toMatchObject({ downSecs: 180 });

    // The feed holds other kinds too; the Monitor filter shows these alone.
    const filters = await alepha
      .inject(ProjectController)
      .getProjectActivityFilters.fetch(
        { params: { id: project.id } },
        { user },
      );
    expect(filters.data.types).toContain("monitor");
    expect(filters.data.pairs).toEqual(
      expect.arrayContaining([
        { type: "monitor", action: "down" },
        { type: "monitor", action: "up" },
      ]),
    );
    expect((await monitorRows()).every((row) => row.type === "monitor")).toBe(
      true,
    );
  }, 30_000);
});
