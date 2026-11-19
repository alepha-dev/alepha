import { DiscordTransport, MemoryDiscordTransport } from "@alepha/discord";
import {
  ProjectChannelController,
  ProjectChannelService,
  ProjectEventDelivery,
  SubscriptionController,
  eventSubscriptions,
} from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { DeployRegistry } from "@lore/ship/api";
import { appInstances, deployments } from "@lore/ship/schemas";
import { Alepha } from "alepha";
import {
  JobProvider,
  JobQueueProvider,
  jobExecutionEntity,
} from "alepha/api/jobs";
import { RankService } from "alepha/api/organizations";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class QuietQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class Rows extends TestEntityRepositories {
  jobs = $repository(jobExecutionEntity);
  subscriptions = $repository(eventSubscriptions);
  instances = $repository(appInstances);
  deployments = $repository(deployments);
}

const WEBHOOK = "https://discord.com/api/webhooks/1234567890/abcDEF-ghi_JKL";

/**
 * Notification channels (#Q3891): a subscription targets a member or a
 * project's channel, and a Discord channel receives the event's fixed
 * message, muted.
 */
describe("Notification channels", () => {
  let alepha: Alepha;
  let rows: Rows;
  let discord: MemoryDiscordTransport;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let owner: UserAccountToken;
  let member: UserAccountToken;
  const channel = () =>
    alepha
      .inject(ProjectChannelService)
      .add(project.id, owner, { name: "alerts", url: WEBHOOK });
  const subscribe = (
    user: UserAccountToken,
    body: {
      event: string;
      filter?: string;
      memberId?: string;
      channelId?: string;
      channels?: ("inapp" | "email")[];
    },
  ) =>
    alepha
      .inject(SubscriptionController)
      .setSubscription.fetch(
        { params: { projectId: project.id }, body },
        { user },
      );
  const drain = async () => {
    const jobs = alepha.inject(JobProvider);
    for (const name of [ProjectEventDelivery.JOB, "system.notifications.send"])
      for (const job of await rows.jobs.findMany({
        where: { jobName: name, status: "pending" },
      }))
        await jobs.processExecution(job.jobName, job.id);
  };
  const fail = async (app: string) => {
    const instance = await rows.instances.create({
      projectId: project.id,
      app,
      env: "production",
      createdBy: owner.id,
    });
    const deployment = await rows.deployments.create({
      projectId: project.id,
      instanceId: instance.id,
      app,
      tag: "latest",
      sha256: "a".repeat(64),
      status: "running",
    });
    await alepha
      .inject(DeployRegistry)
      .failed(deployment.id, "@everyone it broke");
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
      .with({ provide: JobQueueProvider, use: QuietQueue })
      .with({ provide: DiscordTransport, use: MemoryDiscordTransport });
    bootLore(alepha);
    rows = alepha.inject(Rows);
    discord = alepha.inject(MemoryDiscordTransport);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "ship", options: { deploy: true } }],
    });
    await createPresetRanks(alepha, project.id);
    await rows.users.updateById(project.createdBy, { roles: ["user"] });
    owner = { id: project.createdBy, roles: ["user"] };
    const other = await rows.users.create({
      email: "member@example.test",
      roles: ["user"],
    });
    await createTestMember(alepha, project, other.id, { rank: "member" });
    member = { id: other.id, roles: ["user"] };
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("lists channels under their new route, and never their URL", async ({
    expect,
  }) => {
    const created = await channel();
    const listed = await alepha
      .inject(ProjectChannelController)
      .listProjectChannels.fetch(
        { params: { projectId: project.id } },
        { user: owner },
      );
    expect(listed.data.items.map((it) => it.id)).toContain(created.id);
    expect(JSON.stringify(listed.data)).not.toContain("webhooks");
  });

  it("targets a member or a channel, exactly one, and refuses a second identical channel row", async ({
    expect,
  }) => {
    const created = await channel();
    await expect(
      subscribe(owner, {
        event: "deploy.failed",
        memberId: member.id,
        channelId: created.id,
        channels: ["inapp"],
      }),
    ).rejects.toThrow(/not both/);
    const first = await subscribe(owner, {
      event: "deploy.failed",
      channelId: created.id,
    });
    const second = await subscribe(owner, {
      event: "deploy.failed",
      channelId: created.id,
    });
    expect(second.data.id).toBe(first.data.id);
    expect(first.data).toMatchObject({ channelId: created.id, channels: [] });
    expect(first.data.memberId).toBeUndefined();
    await expect(
      subscribe(member, { event: "deploy.failed", channelId: created.id }),
    ).rejects.toThrow(/subscription:manage/);
  });

  it("posts the event's fixed message to a subscribed Discord channel, mentions off, filtered by app", async ({
    expect,
  }) => {
    const created = await channel();
    discord.clear();
    await subscribe(owner, {
      event: "deploy.failed",
      filter: "site",
      channelId: created.id,
    });
    await fail("site");
    await fail("admin");
    await drain();
    expect(discord.posts).toHaveLength(1);
    expect(discord.posts[0].webhook).toBe(WEBHOOK);
    expect(discord.posts[0].payload).toMatchObject({
      allowed_mentions: { parse: [] },
    });
    expect(discord.posts[0].payload.content).toContain(
      "**site failed to deploy to production**",
    );
    expect(JSON.stringify(await rows.jobs.findMany({}))).not.toContain(
      "abcDEF",
    );
  });

  it("deletes a channel's subscriptions with it", async ({ expect }) => {
    const created = await channel();
    await subscribe(owner, { event: "deploy.failed", channelId: created.id });
    await alepha
      .inject(ProjectChannelController)
      .deleteProjectChannel.fetch(
        { params: { projectId: project.id, id: created.id } },
        { user: owner },
      );
    expect(await rows.subscriptions.count({ projectId: project.id })).toBe(0);
  });

  it("allows a channel write with subscription:manage only", async ({
    expect,
  }) => {
    await expect(
      alepha
        .inject(ProjectChannelService)
        .add(project.id, member, { name: "mine", url: WEBHOOK }),
    ).rejects.toThrow(/subscription:manage/);
    await alepha.context.run(() =>
      alepha.inject(RankService).save(
        project.organizationId!,
        {
          key: "ops",
          name: "ops",
          permissions: ["project:read", "subscription:manage"],
        },
        { id: owner.id },
      ),
    );
    await createTestMember(alepha, project, member.id, { rank: "ops" });
    const added = await alepha
      .inject(ProjectChannelService)
      .add(project.id, member, { name: "first", url: WEBHOOK });
    expect(added.name).toBe("first");
  });
});
