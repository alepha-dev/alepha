import { DiscordTransport, MemoryDiscordTransport } from "@alepha/discord";
import {
  AutomationChannelService,
  AutomationEvents,
  AutomationPersistence,
  AutomationService,
  AutomationWorker,
} from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { ReleaseController } from "@lore/plan/api";
import { Alepha, AlephaError } from "alepha";
import {
  JobProvider,
  JobQueueProvider,
  jobExecutionEntity,
} from "alepha/api/jobs";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
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

class DiscordQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class DiscordRows {
  jobs = $repository(jobExecutionEntity);
}

const WEBHOOK = "https://discord.com/api/webhooks/1234567890/abcDEF-ghi_JKL";

/**
 * Discord channels deliver (#Q3615): a rule naming a project's Discord
 * channel posts once through the transport, muted and capped; a worker retry
 * enqueues nothing more; the webhook URL is in no log line, outbox row,
 * snapshot or receipt.
 */
describe("Discord delivery (#Q3615)", () => {
  let alepha: Alepha;
  let entities: TestEntityRepositories;
  let persistence: AutomationPersistence;
  let rows: DiscordRows;
  let discord: MemoryDiscordTransport;
  let logs: MemoryDestinationProvider;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;

  const publish = async (tag: string) => {
    const controller = alepha.inject(ReleaseController);
    const release = (
      await controller.createRelease.fetch(
        {
          params: { projectId: project.id },
          body: { tag, title: `Release ${tag}` },
        },
        { user },
      )
    ).data;
    await controller.publishRelease.fetch(
      { params: { id: release.id }, body: {} },
      { user },
    );
  };
  const step = async () => {
    await alepha.inject(AutomationEvents).sweep(50);
    const ready = await persistence.receipts.findMany({
      where: { kind: "occurrence", status: "ready" },
    });
    for (const receipt of ready) {
      let input: { receiptId: string; token?: string } | undefined = {
        receiptId: receipt.id,
      };
      for (let count = 0; input && count < 20; count++)
        input = await alepha.inject(AutomationWorker).step(input, 3);
      if (input) throw new AlephaError("Discord worker exceeded its budget");
    }
    return ready;
  };
  const deliver = async () => {
    const jobs = await rows.jobs.findMany({
      where: { jobName: "system.notifications.send" },
    });
    for (const job of jobs)
      await alepha.inject(JobProvider).processExecution(job.jobName, job.id);
    return jobs;
  };

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        SERVER_PORT: 0,
        LOG_LEVEL: "trace",
        APP_SECRET: "a-spec-secret-that-is-not-the-default-one",
      },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: DiscordQueue })
      .with({ provide: DiscordTransport, use: MemoryDiscordTransport })
      .with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
      });
    bootLore(alepha);
    entities = alepha.inject(TestEntityRepositories);
    persistence = alepha.inject(AutomationPersistence);
    rows = alepha.inject(DiscordRows);
    discord = alepha.inject(MemoryDiscordTransport);
    logs = alepha.inject(MemoryDestinationProvider);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "plan", options: { releases: true } }],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("posts once to the channel the rule names, muted, and never leaks its URL", async ({
    expect,
  }) => {
    const channel = await alepha
      .inject(AutomationChannelService)
      .add(project.id, user, { name: "alerts", url: WEBHOOK });
    discord.clear();
    await alepha.inject(AutomationService).create(project.id, user, {
      title: "Releases to Discord",
      enabled: true,
      rule: {
        version: 1,
        trigger: { kind: "event", event: "release.published" },
        select: null,
        guard: null,
        actions: [
          {
            kind: "notify",
            channels: [channel.id],
            category: "releases",
            title: "Release {{release_tag}}",
            text: "@everyone {{title}} shipped",
          },
        ],
      },
    });

    await publish("1.0.0");
    const occurrences = await step();
    expect(occurrences).toHaveLength(1);
    const jobs = await deliver();
    expect(jobs).toHaveLength(1);
    expect(discord.posts).toHaveLength(1);
    expect(discord.posts[0].webhook).toBe(WEBHOOK);
    expect(discord.posts[0].payload).toMatchObject({
      allowed_mentions: { parse: [] },
    });
    expect(discord.posts[0].payload.content).toContain("Release 1.0.0");

    // A worker retry over the same occurrence enqueues nothing more.
    for (const receipt of occurrences) {
      let input: { receiptId: string; token?: string } | undefined = {
        receiptId: receipt.id,
      };
      for (let count = 0; input && count < 5; count++)
        input = await alepha.inject(AutomationWorker).step(input, 3);
    }
    expect(
      await rows.jobs.count({ jobName: "system.notifications.send" }),
    ).toBe(1);

    // The URL is in no outbox row, snapshot, receipt or log line.
    const stored = JSON.stringify([
      await rows.jobs.findMany({}),
      await persistence.runs.findMany({}),
      await persistence.receipts.findMany({}),
    ]);
    expect(stored).not.toContain("1234567890/abcDEF");
    expect(stored).toContain(`discord:${channel.id}`);
    expect(JSON.stringify(logs.logs)).not.toContain("1234567890/abcDEF");
  });

  it("cuts a message to Discord's 2000 characters with a visible mark", async ({
    expect,
  }) => {
    const channel = await alepha
      .inject(AutomationChannelService)
      .add(project.id, user, { name: "alerts", url: WEBHOOK });
    discord.clear();
    await alepha.inject(AutomationService).create(project.id, user, {
      title: "Long",
      enabled: true,
      rule: {
        version: 1,
        trigger: { kind: "event", event: "release.published" },
        select: null,
        guard: null,
        actions: [
          {
            kind: "notify",
            channels: [channel.id],
            category: "releases",
            title: "Release {{release_tag}}",
            text: "x".repeat(3000),
          },
        ],
      },
    });
    await publish("1.0.0");
    await step();
    await deliver();
    const content = discord.posts[0].payload.content;
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content.endsWith("(truncated)")).toBe(true);
  });
});
