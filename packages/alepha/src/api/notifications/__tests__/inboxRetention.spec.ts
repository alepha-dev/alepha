import { Alepha } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSms } from "alepha/sms";
import { describe, it } from "vitest";

import {
  AlephaApiNotifications,
  notificationInboxEntity,
  NotificationInboxService,
  NotificationSettings,
} from "../index.ts";

const ME = "11111111-1111-4111-8111-111111111111";
const SOMEBODY_ELSE = "22222222-2222-4222-8222-222222222222";

class Rows {
  readonly repo = $repository(notificationInboxEntity);
}

const boot = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: "sqlite://:memory:" },
  })
    .with(AlephaOrm)
    .with(AlephaEmail)
    .with(AlephaSms)
    .with(AlephaApiJobs)
    .with(AlephaApiNotifications);

  const rows = alepha.inject(Rows);
  await alepha.start();

  return {
    alepha,
    rows,
    inbox: alepha.inject(NotificationInboxService),
    settings: alepha.inject(NotificationSettings),
  };
};

type Ctx = Awaited<ReturnType<typeof boot>>;

const seed = async (
  ctx: Ctx,
  overrides: Record<string, unknown> = {},
): Promise<any> =>
  await ctx.rows.repo.create({
    userId: ME,
    template: "inbox-mentioned",
    title: "You are mentioned",
    href: "/quests/Q1",
    ...overrides,
  } as never);

describe("inbox retention", () => {
  /**
   * The window has to be in the parameter's `default` object, not only in
   * its schema: `cachedCurrentContent` reads the default, and a missing key
   * makes the first sweep after a deploy compute `subtract(undefined, "day")`,
   * an Invalid Date that on sqlite compares as a string against every row.
   */
  it("ships a default and a description for its own window", async ({
    expect,
  }) => {
    const { alepha, settings } = await boot();

    expect(settings.current.inboxRetentionDays).toBe(90);
    expect(typeof settings.current.inboxRetentionDays).toBe("number");

    await alepha.stop();
  });

  it("sweeps read messages past the cutoff and keeps unread ones at any age", async ({
    expect,
  }) => {
    const ctx = await boot();

    const old = "2020-01-01T00:00:00.000Z";
    await seed(ctx, { title: "read and old", createdAt: old, readAt: old });
    await seed(ctx, { title: "unread and old", createdAt: old });
    await seed(ctx, {
      title: "read and recent",
      createdAt: "2026-09-01T00:00:00.000Z",
      readAt: "2026-09-01T00:00:00.000Z",
    });

    const removed = await ctx.inbox.purge("2026-01-01T00:00:00.000Z");
    expect(removed).toBe(1);

    const left = await ctx.rows.repo.findMany({});
    expect(
      left
        .map((it: any) => String(it.title))
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["read and recent", "unread and old"]);

    await ctx.alepha.stop();
  });

  /**
   * Bounded exactly like the executions sweep next door: an unbounded
   * DELETE over a table that grows with every mention is what times an
   * hourly D1 cron out.
   */
  it("deletes at most `limit` rows in one pass", async ({ expect }) => {
    const ctx = await boot();

    const old = "2020-01-01T00:00:00.000Z";
    for (let i = 0; i < 5; i++) {
      await seed(ctx, { title: `m${i}`, createdAt: old, readAt: old });
    }

    expect(await ctx.inbox.purge("2026-01-01T00:00:00.000Z", 2)).toBe(2);
    expect(await ctx.rows.repo.findMany({})).toHaveLength(3);

    await ctx.alepha.stop();
  });

  it("purges nothing when nothing has expired", async ({ expect }) => {
    const ctx = await boot();
    await seed(ctx, { readAt: "2026-09-01T00:00:00.000Z" });

    expect(await ctx.inbox.purge("2020-01-01T00:00:00.000Z")).toBe(0);
    expect(await ctx.rows.repo.findMany({})).toHaveLength(1);

    await ctx.alepha.stop();
  });

  /**
   * The orphan half. `userId` has no foreign key, so nothing cascades and
   * the app has to ask.
   */
  it("removes every message of one account, read or not, and only that account's", async ({
    expect,
  }) => {
    const ctx = await boot();
    await seed(ctx, { title: "mine unread" });
    await seed(ctx, { title: "mine read", readAt: "2026-09-01T00:00:00.000Z" });
    await seed(ctx, { userId: SOMEBODY_ELSE, title: "theirs" });

    expect(await ctx.inbox.deleteForUser(ME)).toBe(2);

    const left = await ctx.rows.repo.findMany({});
    expect(left.map((it: any) => it.title)).toEqual(["theirs"]);

    await ctx.alepha.stop();
  });
});
