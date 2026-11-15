import {
  AutomationController,
  AutomationEvents,
  AutomationPersistence,
  AutomationWorker,
} from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
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
 * Uptime presets and bells (#Q3611): with a monitor's bell on, its outage and
 * its recovery reach the viewer; with the bell off, nothing does.
 */
describe("Uptime bells (#Q3611)", () => {
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
    error: "Connection refused",
  } as const;
  const notifications = () =>
    rows.jobs.findMany({ where: { jobName: "system.notifications.send" } });
  const drain = async () => {
    await alepha.inject(AutomationEvents).sweep(50);
    const ready = await persistence.receipts.findMany({
      where: { kind: "occurrence", status: "ready" },
    });
    for (const receipt of ready) {
      let input: { receiptId: string; token?: string } | undefined = {
        receiptId: receipt.id,
      };
      for (let index = 0; input && index < 20; index++)
        input = await alepha.inject(AutomationWorker).step(input, 3);
      if (input) throw new AlephaError("Bell worker exceeded its budget");
    }
  };
  const bell = (subscribed: boolean, monitor?: string) =>
    alepha.inject(AutomationController).setAutomationSubscription.fetch(
      {
        params: { projectId: project.id },
        body: {
          presets: ["monitor-down", "monitor-up"],
          subscribed,
          ...(monitor ? { scope: { monitor } } : {}),
        },
      },
      { user },
    );
  const seed = (name = "Website") =>
    rows.monitors.create({
      projectId: project.id,
      name,
      kind: "http",
      target: "https://example.test/health",
      confirmations: 1,
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

  it("sends the outage then the recovery to the viewer with the monitor's bell on", async ({
    expect,
  }) => {
    const monitor = await seed();
    expect((await bell(true, monitor.id)).data.subscribed).toBe(true);
    await probe(monitor.id, down);
    await drain();
    const outage = await notifications();
    expect(outage).toHaveLength(1);
    expect(JSON.stringify(outage[0].payload)).toContain("Website is down");
    expect(JSON.stringify(outage[0].payload)).toContain(user.id);
    await probe(monitor.id, up);
    await drain();
    const both = await notifications();
    expect(both).toHaveLength(2);
    expect(JSON.stringify(both.map((job) => job.payload))).toContain(
      "Website recovered",
    );
  });

  it("scopes a monitor's bell to that monitor, and the list bell to every monitor", async ({
    expect,
  }) => {
    const watched = await seed("Website");
    const other = await seed("API");
    await bell(true, watched.id);
    await probe(other.id, down);
    await drain();
    expect(await notifications()).toHaveLength(0);

    await bell(true);
    await probe(other.id, up);
    await drain();
    // The list bell's recovery rule fired for the other monitor.
    expect(await notifications()).toHaveLength(1);
  });

  it("sends nothing once the bell is off", async ({ expect }) => {
    const monitor = await seed();
    await bell(true, monitor.id);
    expect((await bell(false, monitor.id)).data.subscribed).toBe(false);
    await probe(monitor.id, down);
    await probe(monitor.id, up);
    await drain();
    expect(await notifications()).toHaveLength(0);
  });
});
