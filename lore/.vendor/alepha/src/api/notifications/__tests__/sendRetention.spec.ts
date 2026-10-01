import { Alepha } from "alepha";
import {
  AlephaApiJobs,
  JobProvider,
  jobExecutionEntity,
} from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSms } from "alepha/sms";
import { describe, it } from "vitest";

import {
  AlephaApiNotifications,
  NotificationJobs,
  NotificationSettings,
} from "../index.ts";

class TestJobProvider extends JobProvider {
  public testTrimRingBuffers = this.trimRingBuffers.bind(this);
}

class Rows {
  readonly executions = $repository(jobExecutionEntity);
}

const boot = async () => {
  const alepha = Alepha.create()
    .with({ provide: JobProvider, use: TestJobProvider })
    .with(AlephaOrmPostgres)
    .with(AlephaEmail)
    .with(AlephaSms)
    .with(AlephaApiJobs)
    .with(AlephaApiNotifications);

  const rows = alepha.inject(Rows);
  await alepha.start();
  const jobs = alepha.inject(NotificationJobs);

  return {
    alepha,
    jobs,
    rows,
    settings: alepha.inject(NotificationSettings),
    provider: alepha.inject(JobProvider) as TestJobProvider,
    daysAgo: (days: number) =>
      alepha.inject(DateTimeProvider).now().subtract(days, "day").toISOString(),
  };
};

describe("the send job's retention", () => {
  it("reads retentionDays live, for successes and failures alike", async ({
    expect,
  }) => {
    const { jobs, provider, settings } = await boot();
    const name = jobs.sendNotification.name;

    expect(provider.describeRetention(name)).toEqual({
      ok: { days: settings.current.retentionDays },
      error: { days: settings.current.retentionDays },
      source: { ok: "job", error: "job" },
    });

    await settings.parameter.set({ ...settings.current, retentionDays: 2 });

    expect(provider.describeRetention(name)).toMatchObject({
      ok: { days: 2 },
      error: { days: 2 },
    });
  });

  it("is enforced by the trim, and the purge job no longer deletes outbox rows", async ({
    expect,
  }) => {
    const { jobs, provider, rows, settings, daysAgo } = await boot();
    await settings.parameter.set({ ...settings.current, retentionDays: 3 });
    const jobName = jobs.sendNotification.name;

    const create = async (status: "ok" | "error", at: string) =>
      (
        await rows.executions.create({
          jobName,
          status,
          maxAttempts: 1,
          createdAt: at,
          updatedAt: at,
          completedAt: at,
        })
      ).id;
    const expired = [
      await create("ok", daysAgo(5)),
      await create("error", daysAgo(4)),
    ];
    const fresh = [
      await create("ok", daysAgo(1)),
      await create("error", daysAgo(2)),
    ];
    const ids = async () =>
      (
        await rows.executions.findMany({
          where: { jobName: { eq: jobName } },
          columns: ["id"],
        })
      )
        .map((r) => r.id)
        .sort();

    await jobs.purgeOldNotifications.trigger();
    expect(await ids()).toEqual([...expired, ...fresh].sort());

    await provider.testTrimRingBuffers();
    expect(await ids()).toEqual([...fresh].sort());
  });
});
