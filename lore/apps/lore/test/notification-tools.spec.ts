import { DiscordTransport, MemoryDiscordTransport } from "@alepha/discord";
import { ProjectChannelService, projectEvents } from "@lore/core/api";
import { NotificationTools, ThresholdTools } from "@lore/core/mcp";
import { createPresetRanks } from "@lore/core/testing";
import { QuestTools } from "@lore/plan/mcp";
import { Alepha } from "alepha";
import { JobQueueProvider } from "alepha/api/jobs";
import { notificationInboxEntity } from "alepha/api/notifications";
import { RankService } from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import { currentUserAtom, type UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMember,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class QuietQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class Rows extends TestEntityRepositories {
  events = $repository(projectEvents);
  inbox = $repository(notificationInboxEntity);
}

const WEBHOOK = "https://discord.com/api/webhooks/1234567890/abcDEF-ghi_JKL";

/**
 * The four notification tools (#Q3895), on the services the Notifications
 * page's actions call.
 */
describe("Notification tools", () => {
  let alepha: Alepha;
  let rows: Rows;
  let tools: NotificationTools;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let owner: UserAccountToken;
  let member: UserAccountToken;
  const as = <T>(user: UserAccountToken, fn: () => Promise<T>) =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, user);
      return fn();
    });
  const call = (user: UserAccountToken, tool: any, params: object) =>
    as(user, () =>
      tool.execute({ project: project.id, ...params }),
    ) as Promise<any>;

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
    bootLore(alepha, ["api", "mcp"]);
    rows = alepha.inject(Rows);
    tools = alepha.inject(NotificationTools);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [
        { key: "plan", options: { feedback: true, reminder: true } },
        { key: "ship", options: { deploy: true } },
      ],
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

  it("event_catalog lists the events with fields, capability and the reason when unavailable", async ({
    expect,
  }) => {
    const page = await call(owner, tools.event_catalog, {});
    const deploy = page.items.find((it: any) => it.name === "deploy.failed");
    expect(deploy).toMatchObject({
      available: true,
      needs: { capability: "ship" },
      filter: { field: "app" },
    });
    const epic = page.items.find((it: any) => it.name === "epic.completed");
    expect(epic).toMatchObject({ available: false });
    expect(epic.reason).toMatch(/epics/);
    // Host events are Core since #E166: no capability, always available.
    const offline = page.items.find((it: any) => it.name === "host.offline");
    expect(offline).toMatchObject({
      available: true,
      filter: { field: "host_id" },
    });
    expect(offline.needs).toBeUndefined();
    expect(tools.event_catalog.options.description).toMatch(/webhook/);
  });

  it("event_list reads recent events, bounded, and only those whose read permission the caller holds", async ({
    expect,
  }) => {
    const time = alepha.inject(DateTimeProvider);
    for (const [name, minutes] of [
      ["feedback.created", 3],
      ["deploy.failed", 2],
      ["deploy.failed", 1],
    ] as const)
      await rows.events.create({
        projectId: project.id,
        name,
        subjectKind: "x",
        fields: { title: name },
        occurredAt: time.now().subtract(minutes, "minutes").toISOString(),
      });
    const all = await call(owner, tools.event_list, { limit: 2 });
    expect(all.items).toHaveLength(2);
    expect(all.hasMore).toBe(true);
    expect(all.items[0].name).toBe("deploy.failed");
    // A rank without `feedback:read`.
    await alepha.context.run(() =>
      alepha.inject(RankService).save(
        project.organizationId!,
        {
          key: "ops",
          name: "Ops",
          permissions: ["project:read", "app:read"],
        },
        { id: owner.id },
      ),
    );
    await createTestMember(alepha, project, member.id, { rank: "ops" });
    const narrowed = await call(member, tools.event_list, {});
    expect(narrowed.items.map((it: any) => it.name)).toEqual([
      "deploy.failed",
      "deploy.failed",
    ]);
  });

  it("subscription_list shows who is notified of what, never a URL", async ({
    expect,
  }) => {
    await alepha
      .inject(ProjectChannelService)
      .add(project.id, owner, { name: "alerts", url: WEBHOOK });
    await call(owner, tools.subscription_set, {
      event: "deploy.failed",
      member_id: member.id,
    });
    const page = await call(owner, tools.subscription_list, {});
    expect(page.items).toHaveLength(1);
    expect(page.channels.map((it: any) => it.name)).toContain("alerts");
    expect(JSON.stringify(page)).not.toContain("webhooks");
  });

  it("subscription_set subscribes, mutes and removes, and refuses what the rank does not allow", async ({
    expect,
  }) => {
    await expect(
      call(member, tools.subscription_set, {
        event: "deploy.failed",
        member_id: owner.id,
      }),
    ).rejects.toThrow(/subscription:manage/);
    const own = await call(member, tools.subscription_set, {
      event: "deploy.failed",
      channels: ["email"],
    });
    expect(own.subscription).toMatchObject({
      memberId: member.id,
      channels: ["email"],
    });
    const muted = await call(member, tools.subscription_set, {
      verb: "mute",
      id: own.subscription.id,
    });
    expect(muted.subscription.mutedAt).toBeDefined();
    await call(member, tools.subscription_set, {
      verb: "remove",
      id: own.subscription.id,
    });
    expect((await call(member, tools.subscription_list, {})).items).toEqual([]);
  });

  it("channel_update renames a channel and channel_delete removes it with its subscriptions, both with subscription:manage only", async ({
    expect,
  }) => {
    const added = await alepha
      .inject(ProjectChannelService)
      .add(project.id, owner, { name: "alerts", url: WEBHOOK });
    await call(owner, tools.subscription_set, {
      event: "deploy.failed",
      channel_id: added.id,
    });
    await expect(
      call(member, tools.channel_update, { id: added.id, name: "ops" }),
    ).rejects.toThrow(/subscription:manage/);
    const renamed = await call(owner, tools.channel_update, {
      id: added.id,
      name: "ops",
    });
    expect(renamed).toMatchObject({ id: added.id, name: "ops" });
    expect(JSON.stringify(renamed)).not.toContain("webhooks");
    await call(owner, tools.channel_delete, { id: added.id });
    const page = await call(owner, tools.subscription_list, {});
    expect(page.channels.map((it: any) => it.id)).not.toContain(added.id);
    expect(page.items).toEqual([]);
  });

  it("inbox_list reads the caller's own inbox, narrowed to a project, and inbox_read marks it", async ({
    expect,
  }) => {
    for (const [userId, title, scope] of [
      [owner.id, "Here", `project:${project.id}`],
      [owner.id, "Elsewhere", "project:999999"],
      [member.id, "Not yours", `project:${project.id}`],
    ] as const)
      await rows.inbox.create({
        userId,
        title,
        href: "/",
        scope,
        template: "lore:test",
      } as any);
    const anywhere = (user: UserAccountToken, tool: any, params: object) =>
      as(user, () => tool.execute(params)) as Promise<any>;
    const all = await anywhere(owner, tools.inbox_list, {});
    expect(all.items.map((it: any) => it.title).sort()).toEqual([
      "Elsewhere",
      "Here",
    ]);
    expect(all.unreadCount).toBe(2);
    const narrowed = await call(owner, tools.inbox_list, {});
    expect(narrowed.items.map((it: any) => it.title)).toEqual(["Here"]);
    const mine = narrowed.items[0];
    await expect(
      anywhere(member, tools.inbox_read, { id: mine.id }),
    ).rejects.toThrow(/not found/i);
    await anywhere(owner, tools.inbox_read, { id: mine.id });
    const marked = await anywhere(owner, tools.inbox_read, { all: true });
    expect(marked.count).toBe(1);
    expect(
      (await anywhere(owner, tools.inbox_list, { unread: true })).items,
    ).toEqual([]);
  });

  it("threshold_get and threshold_set read and set both thresholds, each behind its permission", async ({
    expect,
  }) => {
    const thresholds = alepha.inject(ThresholdTools);
    expect(await call(owner, thresholds.threshold_get, {})).toEqual({
      coverageMin: null,
      openErrorsMax: null,
    });
    expect(
      await call(owner, thresholds.threshold_set, {
        coverage_min: 80,
        open_errors_max: 5,
      }),
    ).toEqual({ coverageMin: 80, openErrorsMax: 5 });
    expect(
      await call(owner, thresholds.threshold_set, { open_errors_max: null }),
    ).toEqual({ coverageMin: 80, openErrorsMax: null });
    await expect(
      call(member, thresholds.threshold_set, { coverage_min: 10 }),
    ).rejects.toThrow(/app:manage/);
  });

  it("quest_reminder_set sets and clears the assignee's reminder, and refuses anyone else", async ({
    expect,
  }) => {
    const quest = await createTestQuest(alepha, project, {
      acceptedAt: alepha.inject(DateTimeProvider).nowISOString(),
      acceptedBy: owner.id,
    });
    const quests = alepha.inject(QuestTools);
    const set = await call(owner, quests.quest_reminder_set, {
      id: quest.id,
      interval: "weekly",
    });
    expect(set).toMatchObject({ id: quest.id, interval: "weekly" });
    expect(set.nextAt).toBeDefined();
    await expect(
      call(member, quests.quest_reminder_set, {
        id: quest.id,
        interval: "daily",
      }),
    ).rejects.toThrow();
    const cleared = await call(owner, quests.quest_reminder_set, {
      id: quest.id,
      interval: "off",
    });
    expect(cleared.nextAt).toBeUndefined();
  });
});
