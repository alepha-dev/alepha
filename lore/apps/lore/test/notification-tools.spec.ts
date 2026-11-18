import { DiscordTransport, MemoryDiscordTransport } from "@alepha/discord";
import { ProjectChannelService, projectEvents } from "@lore/core/api";
import { NotificationTools } from "@lore/core/mcp";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha } from "alepha";
import { JobQueueProvider } from "alepha/api/jobs";
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
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class QuietQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class Rows extends TestEntityRepositories {
  events = $repository(projectEvents);
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
        { key: "plan", options: { feedback: true } },
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
    const reminder = page.items.find(
      (it: any) => it.name === "quest.reminder_due",
    );
    expect(reminder).toMatchObject({ available: false });
    expect(reminder.reason).toMatch(/reminder/);
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
});
