import { createTestProject } from "@lore/core/testing";
import { Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { $repository } from "alepha/orm";
import { afterEach, describe, it } from "vitest";

import { monitorIncidents } from "../src/api/entities/monitorIncidents.ts";
import { type Monitor, monitors } from "../src/api/entities/monitors.ts";
import { LoreShipApi } from "../src/api/index.ts";
import { UptimeErrorService } from "../src/api/services/UptimeErrorService.ts";
import { UptimeProber } from "../src/api/services/UptimeProber.ts";
import { DeployTestEntities } from "../src/testing/entities.ts";
import { UptimeTickWatch } from "../src/testing/UptimeTickWatch.ts";

class Repositories extends DeployTestEntities {
  monitors = $repository(monitors);
  incidents = $repository(monitorIncidents);
}
class MemoryProber extends UptimeProber {
  failing = true;
  public override async probe(_monitor: Monitor) {
    return this.failing
      ? {
          ok: false,
          result: "timeout" as const,
          latencyMs: 1000,
          error: "Deadline <expired>",
        }
      : { ok: true, result: "up" as const, latencyMs: 20 };
  }
}
class FailingProjectErrors extends UptimeErrorService {
  public override async handle() {
    throw new AlephaError("Injected inbox failure");
  }
}

/**
 * Uptime sends no email of its own since #Q3612: an outage and its recovery
 * are `monitor.down` / `monitor.up` events, and only a rule (a bell) turns
 * them into a message.
 */
describe("Uptime email alerts", () => {
  const containers: Alepha[] = [];
  afterEach(async () => {
    for (const alepha of containers.splice(0)) await alepha.stop();
  });
  const setup = async (failProjectError = false) => {
    const alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        DATABASE_TRANSACTIONS: false,
        LOG_LEVEL: "error",
        PUBLIC_URL: "https://lore.example.test",
      },
    })
      .with(AlephaEmail)
      .with({ provide: UptimeProber, use: MemoryProber });
    if (failProjectError)
      alepha.with({ provide: UptimeErrorService, use: FailingProjectErrors });
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
    await repos.users.updateById(project.createdBy, {
      email: "original-owner@example.com",
    });
    const seed = () =>
      repos.monitors.create({
        projectId: project.id,
        name: "Website <probe>",
        kind: "http",
        target: "https://example.test",
        statusSince: clock.nowISOString(),
        nextCheckAt: clock.nowISOString(),
      });
    return {
      alepha,
      repos,
      clock,
      project,
      seed,
      mail: alepha.inject(MemoryEmailProvider),
      prober: alepha.inject(MemoryProber),
    };
  };

  it("sends no email for an outage and its recovery when no rule exists", async ({
    expect,
  }) => {
    const ctx = await setup(true);
    const monitor = await ctx.seed();
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
    await advance();
    await advance();
    await expect
      .poll(async () => ctx.repos.incidents.count({ monitorId: monitor.id }))
      .toBe(1);
    ctx.prober.failing = false;
    await advance();
    const incident = await ctx.repos.incidents.getOne({
      where: { monitorId: monitor.id },
    });
    expect(incident.endedAt).toBeDefined();
    // The project's owner has an address, and nothing reached it.
    expect(ctx.mail.records).toHaveLength(0);
  });
});
