import { Alepha } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { BadRequestError, NotFoundError } from "alepha/server";
import { AlephaSms } from "alepha/sms";
import { describe, it } from "vitest";

import {
  AlephaApiNotifications,
  notificationInboxEntity,
  NotificationInboxController,
} from "../index.ts";

const ME = "11111111-1111-4111-8111-111111111111";
const SOMEBODY_ELSE = "22222222-2222-4222-8222-222222222222";

class Rows {
  readonly repo = $repository(notificationInboxEntity);
}

/**
 * The controller under both engines.
 *
 * Not decoration: the cursor is a composite over `(createdAt, id)`
 * specifically because the module's millisecond-datetime precedent is
 * documented as lossy on postgres, and this module ships to three postgres
 * apps as well as to D1. A paging spec that only ever runs on one of them
 * proves nothing about the reason the cursor has that shape.
 */
const ENGINES = [
  {
    name: "postgres",
    boot: () =>
      Alepha.create({ env: { LOG_LEVEL: "error" } }).with(AlephaOrmPostgres),
  },
  {
    name: "sqlite",
    boot: () =>
      Alepha.create({
        env: { LOG_LEVEL: "error", DATABASE_URL: "sqlite://:memory:" },
      }).with(AlephaOrm),
  },
] as const;

const boot = async (engine: (typeof ENGINES)[number]) => {
  const alepha = engine
    .boot()
    .with(AlephaSecurity)
    .with(AlephaEmail)
    .with(AlephaSms)
    .with(AlephaApiJobs)
    .with(AlephaApiNotifications);

  const rows = alepha.inject(Rows);
  await alepha.start();

  // Postgres is shared across runs, so a leftover row would be read as one
  // of this test's own.
  await rows.repo.deleteMany({});

  const controller = alepha.inject(NotificationInboxController);

  return {
    alepha,
    rows,
    controller,
    me: { id: ME, realm: "default", sessionId: "s-1" },
    list: (query: Record<string, unknown> = {}, user = ME) =>
      controller.listInbox({ query } as never, {
        user: { id: user, realm: "default", sessionId: "s-1" } as never,
      }),
    count: (query: Record<string, unknown> = {}, user = ME) =>
      controller.countInbox({ query } as never, {
        user: { id: user, realm: "default", sessionId: "s-1" } as never,
      }),
    markRead: (id: string, user = ME) =>
      controller.markInboxRead({ params: { id } } as never, {
        user: { id: user, realm: "default", sessionId: "s-1" } as never,
      }),
    markAllRead: (query: Record<string, unknown> = {}, user = ME) =>
      controller.markAllInboxRead({ query } as never, {
        user: { id: user, realm: "default", sessionId: "s-1" } as never,
      }),
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

for (const engine of ENGINES) {
  describe(`the inbox controller (${engine.name})`, () => {
    it("lists the caller's own messages, newest first", async ({ expect }) => {
      const ctx = await boot(engine);
      await seed(ctx, { title: "one", createdAt: "2026-09-01T10:00:00.000Z" });
      await seed(ctx, { title: "two", createdAt: "2026-09-02T10:00:00.000Z" });
      await seed(ctx, {
        userId: SOMEBODY_ELSE,
        title: "not yours",
        createdAt: "2026-09-03T10:00:00.000Z",
      });

      const page = await ctx.list();

      expect(page.items.map((it: any) => it.title)).toEqual(["two", "one"]);
      expect(page.unreadCount).toBe(2);
      expect(page.nextCursor).toBeUndefined();

      await ctx.alepha.stop();
    });

    /**
     * ⚠️ A row belonging to somebody else is a 404, not a 403: the endpoint
     * must not confirm that an id exists.
     */
    it("answers 404, not 403, for another user's row", async ({ expect }) => {
      const ctx = await boot(engine);
      const theirs = await seed(ctx, { userId: SOMEBODY_ELSE });

      await expect(ctx.markRead(theirs.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );

      // And it is still unread, so the refusal was a refusal.
      const row = await ctx.rows.repo.findById(theirs.id);
      expect(row?.readAt ?? null).toBeNull();

      await ctx.alepha.stop();
    });

    it("does not leak another user's rows into the list or the count", async ({
      expect,
    }) => {
      const ctx = await boot(engine);
      await seed(ctx, { userId: SOMEBODY_ELSE, title: "theirs" });
      await seed(ctx, { title: "mine" });

      const page = await ctx.list();
      expect(page.items.map((it: any) => it.title)).toEqual(["mine"]);
      expect((await ctx.count()).unread).toBe(1);

      // And from the other side, symmetrically.
      const theirPage = await ctx.list({}, SOMEBODY_ELSE);
      expect(theirPage.items.map((it: any) => it.title)).toEqual(["theirs"]);

      await ctx.alepha.stop();
    });

    it("filters on scope by equality and never parses it", async ({
      expect,
    }) => {
      const ctx = await boot(engine);
      await seed(ctx, { title: "a", scope: "project:65" });
      await seed(ctx, { title: "b", scope: "project:1" });
      await seed(ctx, { title: "c" });

      const page = await ctx.list({ scope: "project:65" });
      expect(page.items.map((it: any) => it.title)).toEqual(["a"]);
      expect(page.unreadCount).toBe(1);

      // A scope nobody wrote matches nothing rather than everything.
      expect((await ctx.list({ scope: "project:999" })).items).toHaveLength(0);

      await ctx.alepha.stop();
    });

    it("marks one read, and marks all read within a scope", async ({
      expect,
    }) => {
      const ctx = await boot(engine);
      const one = await seed(ctx, { title: "a", scope: "project:65" });
      await seed(ctx, { title: "b", scope: "project:65" });
      await seed(ctx, { title: "c", scope: "project:1" });

      await ctx.markRead(one.id);
      expect((await ctx.count()).unread).toBe(2);

      await ctx.markAllRead({ scope: "project:65" });
      expect((await ctx.count({ scope: "project:65" })).unread).toBe(0);
      // The other scope is untouched.
      expect((await ctx.count()).unread).toBe(1);

      await ctx.alepha.stop();
    });

    it("returns only unread messages when asked", async ({ expect }) => {
      const ctx = await boot(engine);
      const one = await seed(ctx, { title: "a" });
      await seed(ctx, { title: "b" });

      await ctx.markRead(one.id);

      const page = await ctx.list({ unreadOnly: true });
      expect(page.items.map((it: any) => it.title)).toEqual(["b"]);
      // The count ignores `unreadOnly`: it is the same number either way.
      expect(page.unreadCount).toBe(1);

      await ctx.alepha.stop();
    });

    /**
     * The reason the list is cursor paged rather than offset paged: this
     * list is append-heavy, and an offset page shifts under the reader the
     * moment a message arrives, showing one message twice and hiding
     * another.
     */
    it("pages stably when a message lands between two pages", async ({
      expect,
    }) => {
      const ctx = await boot(engine);
      for (let i = 1; i <= 4; i++) {
        await seed(ctx, {
          title: `m${i}`,
          createdAt: `2026-09-0${i}T10:00:00.000Z`,
        });
      }

      const first = await ctx.list({ limit: 2 });
      expect(first.items.map((it: any) => it.title)).toEqual(["m4", "m3"]);
      expect(first.nextCursor).toBeTruthy();

      // A newer message arrives while the reader is between pages. An offset
      // of 2 would now return m3 again and never show m1.
      await seed(ctx, { title: "m5", createdAt: "2026-09-05T10:00:00.000Z" });

      const second = await ctx.list({ limit: 2, cursor: first.nextCursor });
      expect(second.items.map((it: any) => it.title)).toEqual(["m2", "m1"]);
      expect(second.nextCursor).toBeUndefined();

      await ctx.alepha.stop();
    });

    /**
     * ⚠️ A fan-out over a roster writes several rows in one millisecond. A
     * bare timestamp cursor either repeats them or drops them; the composite
     * over `(createdAt, id)` cuts exactly once.
     */
    it("pages rows sharing one timestamp without repeating or dropping one", async ({
      expect,
    }) => {
      const ctx = await boot(engine);
      const at = "2026-09-01T10:00:00.000Z";
      for (let i = 1; i <= 5; i++) {
        await seed(ctx, { title: `same${i}`, createdAt: at });
      }

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        const result: any = await ctx.list({ limit: 2, cursor });
        seen.push(...result.items.map((it: any) => it.title));
        cursor = result.nextCursor;
        if (!cursor) break;
      }

      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);

      await ctx.alepha.stop();
    });

    it("refuses a malformed cursor rather than silently restarting", async ({
      expect,
    }) => {
      const ctx = await boot(engine);
      await seed(ctx, { title: "a" });

      await expect(ctx.list({ cursor: "not-a-cursor" })).rejects.toBeInstanceOf(
        BadRequestError,
      );
      // Base64 that decodes to something with no separator.
      await expect(
        ctx.list({ cursor: Buffer.from("nope").toString("base64url") }),
      ).rejects.toBeInstanceOf(BadRequestError);

      await ctx.alepha.stop();
    });

    /**
     * The resource is deliberately narrower than the row: `userId` and
     * `organizationId` are the server's business, and every row in a
     * response already belongs to the caller.
     */
    it("publishes the row without userId or organizationId", async ({
      expect,
    }) => {
      const ctx = await boot(engine);
      await seed(ctx, { scope: "project:65", scopeLabel: "Alepha" });

      const [item] = (await ctx.list()).items as any[];
      expect(Object.keys(item).sort()).toEqual([
        "body",
        "category",
        "createdAt",
        "href",
        "id",
        "readAt",
        "scope",
        "scopeLabel",
        "template",
        "title",
      ]);
      expect(item.scopeLabel).toBe("Alepha");

      await ctx.alepha.stop();
    });
  });
}
