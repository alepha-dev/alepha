import { createTestProject } from "@lore/core/testing";
import { Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { $repository } from "alepha/orm";
import { afterEach, describe, it } from "vitest";

import { monitorIncidents } from "../src/api/entities/monitorIncidents.ts";
import { type Monitor, monitors } from "../src/api/entities/monitors.ts";
import { LoreDeployApi } from "../src/api/index.ts";
import { UptimeBlightService } from "../src/api/services/UptimeBlightService.ts";
import { UptimeNotificationService } from "../src/api/services/UptimeNotificationService.ts";
import { UptimeProber } from "../src/api/services/UptimeProber.ts";
import { UptimeStateService } from "../src/api/services/UptimeStateService.ts";
import { DeployTestEntities } from "../src/testing/entities.ts";

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
class FailingBlights extends UptimeBlightService {
  public override async handle() {
    throw new AlephaError("Injected inbox failure");
  }
}

describe("Uptime email alerts", () => {
  const containers: Alepha[] = [];
  afterEach(async () => {
    for (const alepha of containers.splice(0)) await alepha.stop();
  });
  const setup = async (failBlight = false) => {
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
    if (failBlight)
      alepha.with({ provide: UptimeBlightService, use: FailingBlights });
    alepha.with(LoreDeployApi);
    const repos = alepha.inject(Repositories);
    const clock = alepha.inject(DateTimeProvider);
    clock.pause();
    await alepha.start();
    containers.push(alepha);
    const project = await createTestProject(alepha, {
      capabilities: [{ key: "apps", options: { uptime: true } }],
    });
    await repos.users.updateById(project.createdBy, {
      email: "original-owner@example.com",
    });
    const seed = (notifications?: Monitor["notifications"]) =>
      repos.monitors.create({
        projectId: project.id,
        name: "Website <probe>",
        kind: "http",
        target: "https://example.test",
        statusSince: clock.nowISOString(),
        nextCheckAt: clock.nowISOString(),
        ...(notifications ? { notifications } : {}),
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

  it("sends only an outage and a recovery across sixty failed probes, even if the inbox output fails", async ({
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
        )
        .not.toBe(before);
    };
    await advance();
    expect(ctx.mail.records).toHaveLength(0);
    await advance();
    await expect.poll(() => ctx.mail.records.length).toBe(1);
    expect(ctx.mail.records[0]?.to).toBe("original-owner@example.com");
    expect(ctx.mail.records[0]?.subject).toContain("Uptime outage");
    expect(ctx.mail.records[0]?.body).toContain("Website &lt;probe&gt;");
    expect(ctx.mail.records[0]?.body).not.toContain("Website <probe>");
    for (let index = 0; index < 58; index++) await advance();
    expect(ctx.mail.records).toHaveLength(1);
    ctx.prober.failing = false;
    await advance();
    await expect.poll(() => ctx.mail.records.length).toBe(2);
    expect(ctx.mail.records[1]?.subject).toContain("Uptime recovery");
    expect(ctx.mail.records[1]?.body).toContain("after 3540 seconds");
    expect(ctx.mail.records[1]?.body).toContain(`/uptime/${monitor.id}`);
    const incident = await ctx.repos.incidents.getOne({
      where: { monitorId: monitor.id },
    });
    await ctx.alepha.inject(UptimeNotificationService).handle({
      kind: "closed",
      monitor: await ctx.repos.monitors.getById(monitor.id),
      incident,
    });
    expect(ctx.mail.records).toHaveLength(2);
  }, 30_000);

  it("follows the current owner, honors explicit recipients and disables email per monitor", async ({
    expect,
  }) => {
    const ctx = await setup();
    const owner = await ctx.repos.users.create({
      email: "current-owner@example.com",
    });
    await ctx.repos.members.updateMany(
      { organizationId: ctx.project.organizationId! },
      { rank: "member" },
    );
    await ctx.repos.members.create({
      organizationId: ctx.project.organizationId!,
      userId: owner.id,
      rank: "owner",
    });
    const effects = ctx.alepha.inject(UptimeNotificationService);
    const state = ctx.alepha.inject(UptimeStateService);
    const emit = async (monitor: Monitor) => {
      monitor.confirmations = 1;
      await ctx.repos.monitors.save(monitor);
      const transitions = await state.apply(
        monitor,
        { ok: false, result: "timeout", latencyMs: 1000 },
        ctx.clock.nowMillis(),
      );
      for (const transition of transitions) await effects.handle(transition);
    };
    await emit(await ctx.seed());
    await expect.poll(() => ctx.mail.records.length).toBe(1);
    expect(ctx.mail.records[0]?.to).toBe("current-owner@example.com");
    await emit(
      await ctx.seed({
        email: true,
        recipients: ["one@example.com", "two@example.com", "ONE@example.com"],
      }),
    );
    await expect.poll(() => ctx.mail.records.length).toBe(3);
    expect(
      ctx.mail.records
        .slice(1)
        .map((mail) => mail.to)
        .sort(),
    ).toEqual(["one@example.com", "two@example.com"]);
    await emit(
      await ctx.seed({ email: false, recipients: ["muted@example.com"] }),
    );
    expect(ctx.mail.records).toHaveLength(3);
  });
});
