import { DiscordTransport, MemoryDiscordTransport } from "@alepha/discord";
import {
  ProjectChannelService,
  ProjectEventDelivery,
  SubscriptionController,
  projectEvents,
} from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { QuestReminders } from "@lore/plan/api";
import { $hook, Alepha } from "alepha";
import {
  JobProvider,
  JobQueueProvider,
  jobExecutionEntity,
} from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestEpic,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

const onPostgres = process.env.DATABASE_TEST_DIALECT === "postgres";

class QuietQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class Rows extends TestEntityRepositories {
  jobs = $repository(jobExecutionEntity);
  events = $repository(projectEvents);
}
/**
 * Counts the reads the repositories make.
 */
class Reads {
  public count = 0;
  protected readonly onRead = $hook({
    on: "repository:read:after",
    handler: () => {
      this.count++;
    },
  });
}

const WEBHOOK = "https://discord.com/api/webhooks/1234567890/abcDEF-ghi_JKL";

/**
 * Quest reminders are a Plan feature (#Q3893): one hourly check, no
 * automation.
 */
describe("Quest reminders", () => {
  let alepha: Alepha;
  let rows: Rows;
  let time: DateTimeProvider;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  const reminders = () => alepha.inject(QuestReminders);
  const pushed = (template: string) =>
    rows.jobs
      .findMany({ where: { jobName: "system.notifications.send" } })
      .then(
        (jobs) =>
          jobs.filter(
            (job) =>
              (job.payload as { template?: string }).template === template,
          ).length,
      );
  const due = (over: Record<string, unknown> = {}) =>
    createTestQuest(alepha, project, {
      acceptedAt: time.now().subtract(40, "days").toISOString(),
      acceptedBy: user.id,
      reminderInterval: "daily",
      reminderNextAt: time.now().subtract(1, "hour").toISOString(),
      ...over,
    });

  const boot = async (
    options: Record<string, boolean> = { reminder: true },
  ) => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        SERVER_PORT: 0,
        LOG_LEVEL: "silent",
        APP_SECRET: "a-spec-secret-that-is-not-the-default-one",
      },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: QuietQueue })
      .with({ provide: DiscordTransport, use: MemoryDiscordTransport });
    bootLore(alepha);
    rows = alepha.inject(Rows);
    alepha.inject(Reads);
    await alepha.start();
    time = alepha.inject(DateTimeProvider);
    time.pause();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "plan", options }],
    });
    await createPresetRanks(alepha, project.id);
    await rows.users.updateById(project.createdBy, {
      roles: ["user"],
      email: "owner@example.test",
    });
    user = { id: project.createdBy, roles: ["user"] };
  };
  afterEach(async () => {
    await alepha.stop();
  });

  describe("with the option on", () => {
    beforeEach(async () => {
      await boot();
    });

    it("runs from one hourly job on the existing 0 * * * * expression", ({
      expect,
    }) => {
      const hourly = alepha
        .inject(CronProvider)
        .getCronJobs()
        .find((job) => job.name.includes("project-events.hourly"));
      expect(hourly?.expression).toBe("0 * * * *");
    });

    it("reminds the assignee in the app and by email once, across two overlapping ticks", async ({
      expect,
    }) => {
      const quest = await due();
      const now = time.nowISOString();
      const [first, second] = await Promise.all([
        reminders().run(now),
        reminders().run(now),
      ]);
      expect(first + second).toBe(1);
      expect(await pushed("lore:quest:reminder-inbox")).toBe(1);
      expect(await pushed("lore:quest:reminder-email")).toBe(1);
      const after = await rows.quests.getById(quest.id);
      expect(after.reminderNextAt).toBe(time.now().add(1, "day").toISOString());
      expect(after.history.at(-1)).toMatchObject({
        action: "reminder_sent",
        by: user.id,
      });
    });

    it("fires a thirty-day stale reminder once, and advances it from the tick", async ({
      expect,
    }) => {
      const quest = await due({
        reminderNextAt: time.now().subtract(30, "days").toISOString(),
      });
      expect(await reminders().run(time.nowISOString())).toBe(1);
      expect(await reminders().run(time.nowISOString())).toBe(0);
      expect((await rows.quests.getById(quest.id)).reminderNextAt).toBe(
        time.now().add(1, "day").toISOString(),
      );
    });

    it("does not remind a draft, whatever else its row carries", async ({
      expect,
    }) => {
      // No write path accepts a draft, so a due reminder on one is a row
      // only a fixture can make: what it pins is the `draftAt` conjunct.
      const epic = await createTestEpic(alepha, project, { status: "draft" });
      await due({ epicId: epic.id, draftAt: time.nowISOString() });
      await due({ draftAt: time.nowISOString() });
      expect(await reminders().run(time.nowISOString())).toBe(0);
    });

    it("records quest.reminder_due, which a subscribed channel receives", async ({
      expect,
    }) => {
      const channel = await alepha
        .inject(ProjectChannelService)
        .add(project.id, user, { name: "alerts", url: WEBHOOK });
      await alepha.inject(SubscriptionController).setSubscription.fetch(
        {
          params: { projectId: project.id },
          body: { event: "quest.reminder_due", channelId: channel.id },
        },
        { user },
      );
      const discord = alepha.inject(MemoryDiscordTransport);
      discord.clear();
      await due();
      await reminders().run(time.nowISOString());
      expect(
        await rows.events.count({
          projectId: project.id,
          name: "quest.reminder_due",
        }),
      ).toBe(1);
      const jobs = alepha.inject(JobProvider);
      for (const name of [
        ProjectEventDelivery.JOB,
        "system.notifications.send",
      ])
        for (const job of await rows.jobs.findMany({
          where: { jobName: name, status: "pending" },
        }))
          await jobs.processExecution(job.jobName, job.id);
      expect(discord.posts).toHaveLength(1);
      expect(discord.posts[0].payload.content).toContain("Reminder");
    });

    it("costs one query on a tick with nothing due", async ({ expect }) => {
      const reads = alepha.inject(Reads);
      reads.count = 0;
      expect(await reminders().run(time.nowISOString())).toBe(0);
      expect(reads.count).toBe(1);
    });

    // SQLite only on purpose: it reads SQLite's EXPLAIN QUERY PLAN.
    it.skipIf(onPostgres)(
      "finds due quests through the index led by reminderNextAt",
      async ({ expect }) => {
        const plan = await alepha.inject(DatabaseProvider).execute(
          `EXPLAIN QUERY PLAN SELECT id FROM quests
         WHERE reminder_next_at <= 1 AND reminder_interval IS NOT NULL
           AND accepted_at IS NOT NULL AND accepted_by IS NOT NULL
           AND completed_at IS NULL AND shelved_at IS NULL AND deleted_at IS NULL
         ORDER BY reminder_next_at LIMIT 100`,
        );
        expect(JSON.stringify(plan)).toContain("quests_reminders_due_idx");
      },
    );
  });

  it("sends nothing when Plan's reminder option is off", async ({ expect }) => {
    await boot({ reminder: false });
    await due();
    expect(await reminders().run(time.nowISOString())).toBe(0);
    expect(await pushed("lore:quest:reminder-inbox")).toBe(0);
  });
});
