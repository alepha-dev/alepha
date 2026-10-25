import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { beforeEach, describe, expect, it } from "vitest";

import {
  AdminSessionController,
  AlephaApiUsers,
  SessionCrudService,
  UserService,
} from "../index.ts";

const adminUser: UserAccountToken = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Test Admin",
  roles: ["admin"],
};

/**
 * The Admin ▸ Sessions filters (quest #1319, feedback #2005).
 *
 * The page rendered an empty filter bar while every other admin page filled
 * one. These are the server half: the UI shape is copied from `admin-users`
 * and `admin-audits`, but none of these predicates existed before.
 *
 * ⚠️ `search` is the one worth reading. The owner lives in a JOINed table and
 * this repository cannot filter a paginated COUNT on a joined column, so the
 * matching users are resolved to ids first and the session query stays on its
 * own table.
 */
describe("alepha/api/users - session filters", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  const setup = async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);
    await alepha.start();

    const sessionService = alepha.inject(SessionCrudService);
    const userService = alepha.inject(UserService);
    const controller = alepha.inject(AdminSessionController);
    const dateTime = alepha.inject(DateTimeProvider);

    const alice = await userService.users().create({
      username: "alice",
      email: "alice@example.com",
      roles: ["user"],
    });
    const bob = await userService.users().create({
      username: "bob",
      email: "bob@elsewhere.test",
      roles: ["user"],
    });

    const live = await sessionService.sessions().create({
      userId: alice.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: dateTime.now().add(7, "days").toISOString(),
      ip: "10.0.0.1",
      country: "FR",
      lastUsedAt: dateTime.now().subtract(10, "minutes").toISOString(),
    });
    const stale = await sessionService.sessions().create({
      userId: bob.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: dateTime.now().subtract(1, "days").toISOString(),
      ip: "192.168.5.5",
      country: "DE",
      lastUsedAt: dateTime.now().subtract(30, "days").toISOString(),
    });
    // Never used: `lastUsedAt` stays null. It is what a session looks like
    // between being minted and being used a second time.
    const fresh = await sessionService.sessions().create({
      userId: bob.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: dateTime.now().add(7, "days").toISOString(),
      ip: "10.0.0.2",
      country: "FR",
    });

    const ids = async (query: Record<string, unknown>) => {
      const page = await controller.findSessions(
        { query: query as never },
        {
          user: adminUser,
        },
      );
      return page.content.map((session) => session.id).sort();
    };

    return { alepha, ids, live, stale, fresh, alice, bob };
  };

  beforeEach(async () => {
    ctx = await setup();
  });

  it("finds a session by its owner's email", async () => {
    expect(await ctx.ids({ search: "alice@example" })).toEqual([ctx.live.id]);
  });

  it("finds a session by its owner's username", async () => {
    expect(await ctx.ids({ search: "bob" })).toEqual(
      [ctx.stale.id, ctx.fresh.id].sort(),
    );
  });

  it("finds a session by its IP, with the same box", async () => {
    // One control for both, because an admin looking a session up has one
    // string in hand and should not have to say which kind it is.
    expect(await ctx.ids({ search: "192.168" })).toEqual([ctx.stale.id]);
  });

  it("returns nothing when a search matches neither an owner nor an IP", async () => {
    // The interesting failure: `inArray: []` throws rather than matching
    // nothing, so an unmatched owner list has to be expressed some other way.
    expect(await ctx.ids({ search: "nobody-at-all" })).toEqual([]);
  });

  it("separates active from expired", async () => {
    expect(await ctx.ids({ status: "active" })).toEqual(
      [ctx.live.id, ctx.fresh.id].sort(),
    );
    expect(await ctx.ids({ status: "expired" })).toEqual([ctx.stale.id]);
  });

  it("filters by country, case-insensitively", async () => {
    expect(await ctx.ids({ country: "FR" })).toEqual(
      [ctx.live.id, ctx.fresh.id].sort(),
    );
    expect(await ctx.ids({ country: "de" })).toEqual([ctx.stale.id]);
  });

  it("excludes a never-used session from a last-used window", async () => {
    // `lastUsedAt` is null until a session is used a second time, and a
    // never-used session is not "recently active" - so it is out, not in.
    expect(await ctx.ids({ lastUsedWithinHours: 24 })).toEqual([ctx.live.id]);
  });

  it("combines filters", async () => {
    expect(await ctx.ids({ search: "bob", status: "active" })).toEqual([
      ctx.fresh.id,
    ]);
  });

  it("lists only the country codes sessions actually carry", async () => {
    const countries = await ctx.alepha
      .inject(SessionCrudService)
      .getSessionCountries();
    expect(countries).toEqual(["DE", "FR"]);
  });
});
