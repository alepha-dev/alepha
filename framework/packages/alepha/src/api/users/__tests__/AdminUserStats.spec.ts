import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { describe, expect, it } from "vitest";

import {
  AdminUserController,
  AlephaApiUsers,
  RealmProvider,
  SessionCrudService,
  UserService,
} from "../index.ts";

const DAY = 86_400_000;

const adminOf = (realm?: string): { user: UserAccountToken } => ({
  user: {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Test Admin",
    roles: ["admin"],
    realm,
  },
});

/**
 * The admin dashboard's user numbers (#Q3535): one action for the Users and
 * Connected tiles, and the `activeWithinHours` filter the Connected tile
 * links to, which must total the same number by construction.
 */
describe.each([
  [
    "sqlite",
    () => Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
  ],
  ["postgres", () => Alepha.create().with(AlephaOrmTestPostgres)],
])("alepha/api/users - getUserStats (%s)", (_name, create) => {
  const setup = async () => {
    const alepha = create();
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);
    await alepha.start();
    const realms = alepha.inject(RealmProvider);
    realms.register("tenant-a");
    realms.register("tenant-b");

    const dateTime = alepha.inject(DateTimeProvider);
    // Frozen, so a run crossing UTC midnight cannot move the windows under
    // the rows placed on their edges.
    dateTime.pause();
    const now = dateTime.nowMillis();
    const end = Math.floor(now / DAY) * DAY + DAY;
    const from = end - 7 * DAY;

    const userService = alepha.inject(UserService);
    const sessions = alepha.inject(SessionCrudService);
    const controller = alepha.inject(AdminUserController);
    const tag = Math.random().toString(36).slice(2, 8);

    const user = async (realm: string, name: string, createdAt?: number) => {
      const created = await userService.createUser(
        { email: `${name}-${tag}@example.com`, username: `${name}${tag}` },
        realm,
      );
      if (createdAt !== undefined) {
        await userService.users(realm).updateById(created.id, {
          createdAt: new Date(createdAt).toISOString(),
        });
      }
      return created;
    };

    const session = async (
      user: { id: string; realm: string },
      lastUsedAgoMs?: number,
    ) =>
      sessions.sessions(user.realm).create({
        userId: user.id,
        refreshToken: crypto.randomUUID(),
        expiresAt: new Date(now + 7 * DAY).toISOString(),
        lastUsedAt:
          lastUsedAgoMs === undefined
            ? undefined
            : new Date(now - lastUsedAgoMs).toISOString(),
      });

    return { alepha, controller, userService, user, session, now, end, from };
  };

  it("counts a user with two recent sessions once", async () => {
    const ctx = await setup();
    const alice = await ctx.user("tenant-a", "alice");
    await ctx.session(alice, 60_000);
    await ctx.session(alice, 3_600_000);

    const stats = await ctx.controller.getUserStats(
      { query: { userRealmName: "tenant-a" } },
      adminOf("tenant-a"),
    );
    expect(stats.connected).toBe(1);
    expect(stats.connectedHours).toBe(24);
  });

  it("does not count another realm's sessions, nor stale or never-used ones", async () => {
    const ctx = await setup();
    const alice = await ctx.user("tenant-a", "alice");
    const stale = await ctx.user("tenant-a", "stale");
    const never = await ctx.user("tenant-a", "never");
    const bob = await ctx.user("tenant-b", "bob");
    await ctx.session(alice, 60_000);
    await ctx.session(stale, 25 * 3_600_000);
    await ctx.session(never);
    await ctx.session(bob, 60_000);

    const statsA = await ctx.controller.getUserStats(
      { query: { userRealmName: "tenant-a" } },
      adminOf("tenant-a"),
    );
    expect(statsA.total).toBe(3);
    expect(statsA.connected).toBe(1);

    const statsB = await ctx.controller.getUserStats(
      { query: { userRealmName: "tenant-b" } },
      adminOf("tenant-b"),
    );
    expect(statsB.total).toBe(1);
    expect(statsB.connected).toBe(1);
  });

  it("totals the same as findUsers({ activeWithinHours }) by construction", async () => {
    const ctx = await setup();
    const alice = await ctx.user("tenant-a", "alice");
    const carol = await ctx.user("tenant-a", "carol");
    await ctx.user("tenant-a", "dave");
    const bob = await ctx.user("tenant-b", "bob");
    await ctx.session(alice, 60_000);
    await ctx.session(alice, 120_000);
    await ctx.session(carol, 2 * 3_600_000);
    await ctx.session(bob, 60_000);

    const stats = await ctx.controller.getUserStats(
      { query: { userRealmName: "tenant-a" } },
      adminOf("tenant-a"),
    );
    const page = await ctx.controller.findUsers(
      { query: { userRealmName: "tenant-a", activeWithinHours: 24, size: 1 } },
      adminOf("tenant-a"),
    );
    expect(stats.connected).toBe(2);
    expect(page.page.totalElements).toBe(stats.connected);

    const all = await ctx.controller.findUsers(
      { query: { userRealmName: "tenant-a", size: 1 } },
      adminOf("tenant-a"),
    );
    expect(all.page.totalElements).toBe(stats.total);

    const narrow = await ctx.controller.findUsers(
      { query: { userRealmName: "tenant-a", activeWithinHours: 1 } },
      adminOf("tenant-a"),
    );
    expect(narrow.content.map((u) => u.id)).toEqual([alice.id]);
  });

  it("splits sign-ups at UTC midnight into whole-day windows", async () => {
    const ctx = await setup();
    // On the current window's first instant: in.
    await ctx.user("tenant-a", "first", ctx.from);
    // The last millisecond of today: in.
    await ctx.user("tenant-a", "last", ctx.end - 1);
    // One millisecond before the window: the previous window.
    await ctx.user("tenant-a", "before", ctx.from - 1);
    // The previous window's first instant: in it.
    await ctx.user("tenant-a", "prevFirst", ctx.from - 7 * 86_400_000);
    // Before both windows: neither.
    await ctx.user("tenant-a", "older", ctx.from - 7 * 86_400_000 - 1);

    const stats = await ctx.controller.getUserStats(
      { query: { userRealmName: "tenant-a" } },
      adminOf("tenant-a"),
    );
    expect(stats.total).toBe(5);
    expect(stats.signups.current).toBe(2);
    expect(stats.signups.previous).toBe(2);
    expect(stats.signups.from).toBe(new Date(ctx.from).toISOString());
    expect(stats.signups.to).toBe(new Date(ctx.end).toISOString());
    expect(stats.signups.from.endsWith("T00:00:00.000Z")).toBe(true);
    expect(stats.windowDays).toBe(7);
  });

  it("takes the window lengths from the query", async () => {
    const ctx = await setup();
    await ctx.user("tenant-a", "today", ctx.end - 1);
    await ctx.user("tenant-a", "yesterday", ctx.end - 86_400_000 - 1);

    const stats = await ctx.controller.getUserStats(
      { query: { userRealmName: "tenant-a", windowDays: 1 } },
      adminOf("tenant-a"),
    );
    expect(stats.signups.current).toBe(1);
    expect(stats.signups.previous).toBe(1);
  });
});
