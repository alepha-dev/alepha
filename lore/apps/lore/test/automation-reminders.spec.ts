import { DiscordTransport, MemoryDiscordTransport } from "@alepha/discord";
import {
  AutomationChannelService,
  AutomationClaims,
  AutomationController,
  AutomationEvaluator,
  AutomationNotificationOutbox,
  AutomationPersistence,
  AutomationWorker,
} from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { QuestReminderRuleController } from "@lore/plan/api";
import { Alepha, AlephaError } from "alepha";
import {
  JobProvider,
  JobQueueProvider,
  jobExecutionEntity,
} from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class ReminderQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class ReminderOutbox extends AutomationNotificationOutbox {
  public override async dispatch() {}
}
class ReminderRows {
  jobs = $repository(jobExecutionEntity);
}
class ReminderClaimFault extends AutomationClaims {
  public crash = false;
  public override async continueReminderSelection(
    ...args: Parameters<AutomationClaims["continueReminderSelection"]>
  ) {
    const receipt = await super.continueReminderSelection(...args);
    if (this.crash) {
      this.crash = false;
      throw new AlephaError("Interrupted after committed reminder page");
    }
    return receipt;
  }
}

/**
 * Quest reminders go only through an automation (#Q3626): the Quest
 * reminders preset, at most one per project. Without it nothing is sent.
 */
describe("Quest reminders through an automation (#Q3626)", () => {
  let alepha: Alepha;
  let entities: TestEntityRepositories;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  let persistence: AutomationPersistence;
  let api: AutomationController;
  let rows: ReminderRows;
  let time: DateTimeProvider;
  const notifications = () =>
    rows.jobs.count({ jobName: "system.notifications.send" });
  const finish = async (receiptId: string, token?: string) => {
    let input: { receiptId: string; token?: string } | undefined = {
      receiptId,
      token,
    };
    for (let count = 0; input && count < 150; count++)
      input = await alepha.inject(AutomationWorker).step(input, 3);
    if (input)
      throw new AlephaError("Reminder worker exceeded its continuation budget");
  };
  const createRule = async () =>
    (
      await api.createAutomationFromPreset.fetch(
        {
          params: { projectId: project.id },
          body: {
            key: "quest-reminders",
            values: { channel: "email" },
            enabled: true,
          },
        },
        { user },
      )
    ).data;
  const run = async (automationId: string) => {
    const stored = await persistence.rules.getById(automationId);
    const evaluation = await alepha
      .inject(AutomationEvaluator)
      .evaluate({ rule: stored, evaluatedAt: time.nowISOString() });
    if (evaluation.refusal)
      throw new AlephaError(`Reminder rule refused: ${evaluation.refusal}`);
    return alepha.inject(AutomationClaims).claim({
      automationId: stored.id,
      revision: stored.revision,
      source: { kind: "schedule", scheduledAt: time.nowISOString() },
      prepared: evaluation.prepared!,
    });
  };
  const dueQuests = async (count: number) => {
    const due = time.now().subtract(1, "hour").toISOString();
    for (let index = 0; index < count; index++)
      await createTestQuest(alepha, project, {
        acceptedBy: user.id,
        acceptedAt: time.now().subtract(2, "days").toISOString(),
        reminderInterval: "daily",
        reminderNextAt: due,
      });
  };
  const sentOnce = async () => {
    const quests = await entities.quests.findMany({
      where: { projectId: project.id },
      limit: 100,
    });
    return quests.every(
      (quest) =>
        quest.history.filter((entry) => entry.action === "reminder_sent")
          .length === 1 &&
        quest.reminderNextAt === time.now().add(24, "hour").toISOString(),
    );
  };
  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        SERVER_PORT: 0,
        LOG_LEVEL: "silent",
        APP_SECRET: "a-spec-secret-that-is-not-the-default-one",
      },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: ReminderQueue })
      .with({ provide: AutomationNotificationOutbox, use: ReminderOutbox })
      .with({ provide: AutomationClaims, use: ReminderClaimFault })
      .with({ provide: DiscordTransport, use: MemoryDiscordTransport });
    bootLore(alepha);
    entities = alepha.inject(TestEntityRepositories);
    persistence = alepha.inject(AutomationPersistence);
    api = alepha.inject(AutomationController);
    rows = alepha.inject(ReminderRows);
    time = alepha.inject(DateTimeProvider);
    await alepha.start();
    time.pause();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "plan", options: { reminder: true } }],
    });
    await entities.users.updateById(project.createdBy, {
      roles: ["user"],
      email: `author-${project.id}@example.test`,
    });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("creates an ordinary rule keyed by its selector, at most one per project", async ({
    expect,
  }) => {
    const rule = await createRule();
    const stored = await persistence.rules.getById(rule.id);
    expect(stored.rule).not.toHaveProperty("compatibility");
    expect(stored.rule.select?.key).toBe("quests.remindersDue");
    expect(stored.rule.actions[0]).toMatchObject({
      recipient: "{{assignee_id}}",
      channels: ["email"],
    });
    expect(stored.enabled).toBe(true);
    await expect(createRule()).rejects.toThrow("already has");
    const read = alepha.inject(QuestReminderRuleController);
    expect(
      (
        await read.getQuestReminderRule.fetch(
          { params: { projectId: project.id } },
          { user },
        )
      ).data,
    ).toEqual({ exists: true, enabled: true, automationId: rule.id });
  });

  it("sends a due reminder once to the assignee with the rule, and nothing without it", async ({
    expect,
  }) => {
    await dueQuests(1);
    // No rule: the hourly crons run and nothing is sent.
    await time.travel(1, "hour");
    expect(await notifications()).toBe(0);
    expect(
      (
        await alepha
          .inject(QuestReminderRuleController)
          .getQuestReminderRule.fetch(
            { params: { projectId: project.id } },
            { user },
          )
      ).data,
    ).toEqual({ exists: false, enabled: false });

    const rule = await createRule();
    const claim = await run(rule.id);
    expect(claim.state).toBe("claimed");
    await finish(claim.receipt!.id, claim.receipt!.leaseToken);
    expect(await notifications()).toBe(1);
    const [job] = await rows.jobs.findMany({
      where: { jobName: "system.notifications.send" },
    });
    expect(JSON.stringify(job.payload)).toContain(user.id);
    expect(await sentOnce()).toBe(true);

    // A replay of the same occurrence sends nothing more.
    await finish(claim.receipt!.id, claim.receipt!.leaseToken);
    expect(await notifications()).toBe(1);
  });

  it("posts each due reminder once to a Discord channel and settles the quest (#Q3689)", async ({
    expect,
  }) => {
    const channel = await alepha
      .inject(AutomationChannelService)
      .add(project.id, user, {
        name: "reminders",
        url: "https://discord.com/api/webhooks/1234567890/reminders-token",
      });
    const discord = alepha.inject(MemoryDiscordTransport);
    discord.clear();
    await dueQuests(2);
    const rule = (
      await api.createAutomationFromPreset.fetch(
        {
          params: { projectId: project.id },
          body: {
            key: "quest-reminders",
            values: { channel: channel.id },
            enabled: true,
          },
        },
        { user },
      )
    ).data;
    expect(
      (await persistence.rules.getById(rule.id)).rule.actions[0],
    ).toMatchObject({ channels: [channel.id] });
    const claim = await run(rule.id);
    await finish(claim.receipt!.id, claim.receipt!.leaseToken);
    expect(await notifications()).toBe(2);
    expect(await sentOnce()).toBe(true);
    const jobs = await rows.jobs.findMany({
      where: { jobName: "system.notifications.send" },
    });
    expect(JSON.stringify(jobs)).not.toContain("reminders-token");
    for (const job of jobs)
      await alepha.inject(JobProvider).processExecution(job.jobName, job.id);
    expect(discord.posts).toHaveLength(2);
    expect(discord.posts[0].payload.content).toContain("is still open");

    // A replay sends nothing more.
    await finish(claim.receipt!.id, claim.receipt!.leaseToken);
    expect(await notifications()).toBe(2);
  });

  it("progresses beyond fifty due reminders without duplicating history or the interval", async ({
    expect,
  }) => {
    await dueQuests(51);
    const rule = await createRule();
    const claim = await run(rule.id);
    await finish(claim.receipt!.id, claim.receipt!.leaseToken);
    expect((await persistence.receipts.getById(claim.receipt!.id)).status).toBe(
      "committed",
    );
    expect(await sentOnce()).toBe(true);
    expect(await notifications()).toBe(51);
    await finish(claim.receipt!.id, claim.receipt!.leaseToken);
    expect(await notifications()).toBe(51);
  }, 30_000);

  it("resumes the next reminder page after its native cursor witness committed", async ({
    expect,
  }) => {
    await dueQuests(51);
    const rule = await createRule();
    const claimed = await run(rule.id);
    (alepha.inject(AutomationClaims) as ReminderClaimFault).crash = true;
    let input: { receiptId: string; token?: string } | undefined = {
      receiptId: claimed.receipt!.id,
      token: claimed.receipt!.leaseToken,
    };
    let interrupted = false;
    for (let count = 0; input && count < 20; count++) {
      try {
        input = await alepha.inject(AutomationWorker).step(input);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("Interrupted after committed reminder page")
        )
          throw error;
        interrupted = true;
        break;
      }
    }
    expect(interrupted).toBe(true);
    expect(await notifications()).toBe(50);
    const receipt = await persistence.receipts.getById(claimed.receipt!.id);
    await finish(receipt.id, receipt.leaseToken);
    expect(await notifications()).toBe(51);
    expect(await sentOnce()).toBe(true);
  }, 30_000);
});
