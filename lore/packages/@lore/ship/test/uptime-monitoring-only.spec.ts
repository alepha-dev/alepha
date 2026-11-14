import { createTestProject } from "@lore/core/testing";
import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { $repository } from "alepha/orm";
import { afterEach, describe, it } from "vitest";

import { MonitorController } from "../src/api/controllers/MonitorController.ts";
import { appInstances } from "../src/api/entities/appInstances.ts";
import { monitorIncidents } from "../src/api/entities/monitorIncidents.ts";
import type { Monitor } from "../src/api/entities/monitors.ts";
import { monitors } from "../src/api/entities/monitors.ts";
import { sigils } from "../src/api/entities/sigils.ts";
import { LoreShipApi } from "../src/api/index.ts";
import { UptimeProber } from "../src/api/services/UptimeProber.ts";
import { DeployTestEntities } from "../src/testing/entities.ts";

class Repositories extends DeployTestEntities {
  monitors = $repository(monitors);
  incidents = $repository(monitorIncidents);
  sigils = $repository(sigils);
  appInstances = $repository(appInstances);
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
 * Monitoring only (#Q3597): a project whose one capability is Apps, with
 * Track and Deploy off and Monitor apps on. No sigil, no app instance, no
 * deploy, no Work: monitors, their history and their alerts still work.
 */
describe("A monitoring-only project", () => {
  const containers: Alepha[] = [];
  afterEach(async () => {
    for (const alepha of containers.splice(0)) await alepha.stop();
  });

  it("checks any URL, keeps its history and alerts, with Track and Deploy off", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        DATABASE_TRANSACTIONS: false,
        LOG_LEVEL: "error",
        PUBLIC_URL: "https://lore.example.test",
      },
    })
      .with(AlephaEmail)
      .with({ provide: UptimeProber, use: MemoryProber })
      .with(LoreShipApi);
    const repos = alepha.inject(Repositories);
    const clock = alepha.inject(DateTimeProvider);
    clock.pause();
    await alepha.start();
    containers.push(alepha);
    const project = await createTestProject(alepha, {
      capabilities: [
        {
          key: "ship",
          options: { track: false, deploy: false, uptime: true },
        },
      ],
    });
    await repos.users.updateById(project.createdBy, {
      email: "owner@example.com",
    });
    const user = { id: project.createdBy, roles: ["user"] };
    const api = alepha.inject(MonitorController);
    const prober = alepha.inject(MemoryProber);
    const mail = alepha.inject(MemoryEmailProvider);

    const created = await api.createMonitor.fetch(
      {
        params: { projectId: project.id },
        body: {
          name: "Status page",
          kind: "http",
          target: "https://status.example.test",
          intervalSecs: 60,
          timeoutSecs: 10,
          confirmations: 2,
          expect: {},
        },
      },
      { user },
    );
    const id = created.data.monitor.id;
    const advance = async () => {
      const before = (await repos.monitors.getById(id)).lastCheckedAt;
      await clock.travel(1, "minute");
      await expect
        .poll(async () => (await repos.monitors.getById(id)).lastCheckedAt)
        .not.toBe(before);
    };

    await advance();
    expect((await repos.monitors.getById(id)).status).toBe("up");
    prober.failing = true;
    await advance();
    await advance();
    expect((await repos.monitors.getById(id)).status).toBe("down");
    await expect.poll(() => mail.records.length).toBe(1);
    expect(mail.records[0]?.to).toBe("owner@example.com");
    prober.failing = false;
    await advance();
    await expect.poll(() => mail.records.length).toBe(2);

    const detail = await api.getMonitorDetail.fetch(
      { params: { monitorId: id }, query: { window: "24h" } },
      { user },
    );
    expect(detail.data.monitor.status).toBe("up");
    expect(detail.data.incidents).toHaveLength(1);
    expect(detail.data.incidents[0]?.endedAt).toBeDefined();

    const list = await api.listMonitors.fetch(
      { params: { projectId: project.id }, query: { window: "24h" } },
      { user },
    );
    expect(list.data.items).toHaveLength(1);
    expect(list.data.items[0]?.beats.length).toBeGreaterThanOrEqual(4);

    expect(await repos.sigils.count()).toBe(0);
    expect(await repos.appInstances.count()).toBe(0);
  }, 30_000);
});
