import { AbortedError, Alepha, TimeoutError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import {
  $entity,
  $relations,
  $repository,
  DatabaseProvider,
  DbTimeoutError,
  db,
  sql,
} from "../core/index.ts";
import { FakeD1 } from "../core/providers/drivers/__tests__/fakeD1.ts";
import { CloudflareD1Provider } from "../core/providers/drivers/CloudflareD1Provider.ts";

/**
 * A statement's `timeout`, and `DATABASE_TIMEOUT` as its default on every
 * driver (#E87).
 */
describe("ORM timeout", () => {
  const notes = $entity({
    name: "timeout_notes",
    schema: z.object({
      id: db.primaryKey(z.integer()),
      title: z.text(),
    }),
  });

  const comments = $entity({
    name: "timeout_comments",
    schema: z.object({
      id: db.primaryKey(z.integer()),
      noteId: db.ref(z.integer(), () => notes.cols.id),
      body: z.text(),
    }),
  });

  const relations = $relations({ notes, comments }, (r) => ({
    notes: {
      comments: r.many.comments({ from: r.notes.id, to: r.comments.noteId }),
    },
  }));

  class App {
    notes = $repository(notes);
    related = $repository(relations, "notes");
    comments = $repository(relations, "comments");
  }

  const boot = async (alepha: Alepha) => {
    const app = alepha.inject(App);
    await alepha.start();
    const time = alepha.inject(DateTimeProvider);
    time.pause();
    return { alepha, app, time };
  };

  /**
   * How many statements holding `needle` postgres is running for THIS
   * instance. `pg_stat_activity` is server-wide, and another run of the suite
   * on the same server sleeps on the same statement: the instance's own test
   * schema, which qualifies the table in the statement text, tells them
   * apart.
   */
  const running = async (alepha: Alepha, needle: string): Promise<number> => {
    const database = alepha.inject(DatabaseProvider);
    const like = `%${database.schema}%${needle}%`;
    const rows = await database.execute(
      sql`select count(*)::int as n from pg_stat_activity where state = 'active' and query like ${like} and pid <> pg_backend_pid()`,
    );
    return Number(rows[0].n);
  };

  const until = async (check: () => Promise<boolean>) => {
    const end = Date.now() + 3000;
    while (Date.now() < end) {
      if (await check()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
  };

  describe("PostgreSQL (postgres.js)", () => {
    it("fails a slow read with DbTimeoutError under travel(), and lets postgres finish it", async ({
      expect,
    }) => {
      const { alepha, app, time } = await boot(
        Alepha.create().with(AlephaOrmTestPostgres),
      );
      await app.notes.create({ title: "slow" });

      const read = app.notes
        .count(sql`pg_sleep(1.5) is not null`, { timeout: [1, "seconds"] })
        .catch((error: unknown) => error);
      expect(
        await until(async () => (await running(alepha, "pg_sleep(1.5)")) > 0),
      ).toBe(true);
      await time.travel([1, "seconds"]);

      const error = await read;
      expect(error).toBeInstanceOf(DbTimeoutError);
      expect((error as DbTimeoutError).status).toBe(503);
      expect((error as Error).cause).toBeInstanceOf(TimeoutError);
      // The caller is released, the statement is never cancelled (#Q3746).
      expect(await running(alepha, "pg_sleep(1.5)")).toBe(1);
    });

    it("reads DATABASE_TIMEOUT as the default, and a statement's own timeout wins", async ({
      expect,
    }) => {
      const { alepha, app, time } = await boot(
        Alepha.create({ env: { DATABASE_TIMEOUT: 1000 } }).with(
          AlephaOrmTestPostgres,
        ),
      );
      await app.notes.create({ title: "slow" });

      const bounded = app.notes
        .count(sql`pg_sleep(4.2) is not null`)
        .catch((error: unknown) => error);
      let opted = false;
      const unbounded = app.notes
        .count(sql`pg_sleep(0.3) is not null`, { timeout: false })
        .then(() => {
          opted = true;
          return undefined;
        });
      expect(
        await until(async () => (await running(alepha, "pg_sleep(4.2)")) > 0),
      ).toBe(true);
      await time.travel([1, "seconds"]);

      expect(await bounded).toBeInstanceOf(DbTimeoutError);
      await unbounded;
      expect(opted).toBe(true);
    });

    it("bounds a relational read by DATABASE_TIMEOUT as it does a plain one", async ({
      expect,
    }) => {
      const { alepha, app, time } = await boot(
        Alepha.create({ env: { DATABASE_TIMEOUT: 1000 } }).with(
          AlephaOrmTestPostgres,
        ),
      );
      await app.notes.create({ title: "slow" });

      const read = app.related
        .findMany({
          where: { and: [sql`pg_sleep(1.7) is not null`] },
          include: { comments: true },
        })
        .catch((error: unknown) => error);
      expect(
        await until(async () => (await running(alepha, "pg_sleep(1.7)")) > 0),
      ).toBe(true);
      await time.travel([1, "seconds"]);

      expect(await read).toBeInstanceOf(DbTimeoutError);
    });

    it("never makes a write inherit the unit's signal through its timeout", async ({
      expect,
    }) => {
      const { alepha, app } = await boot(
        Alepha.create().with(AlephaOrmTestPostgres),
      );
      const gone = new AbortController();
      gone.abort(new AbortedError("client gone"));

      await alepha.context.run(
        () => app.notes.create({ title: "kept" }, { timeout: [5, "seconds"] }),
        { signal: gone.signal },
      );

      expect((await app.notes.findMany()).map((it) => it.title)).toEqual([
        "kept",
      ]);
    });
  });

  describe("SQLite", () => {
    it("lets a timed statement finish", async ({ expect }) => {
      const { app } = await boot(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );

      await app.notes.create({ title: "a" }, { timeout: [1, "seconds"] });
      expect(await app.notes.count({}, { timeout: [1, "seconds"] })).toBe(1);
    });
  });

  describe("Cloudflare D1", () => {
    const d1 = async (env: Record<string, unknown> = {}) => {
      const binding = new FakeD1();
      const alepha = Alepha.create({
        env: { DATABASE_URL: "d1://DB", ALEPHA_SERVERLESS: true, ...env },
      }).with({ provide: DatabaseProvider, use: CloudflareD1Provider });
      alepha.store.set("cloudflare.env", { DB: binding });
      return { binding, ...(await boot(alepha)) };
    };

    it("applies a statement's own timeout with DATABASE_TIMEOUT off", async ({
      expect,
    }) => {
      const { binding, app, time } = await d1({ DATABASE_TIMEOUT: 0 });
      binding.stalling = true;

      const read = app.notes
        .findMany({}, { timeout: [2, "seconds"] })
        .catch((error: unknown) => error);
      await time.travel([2, "seconds"]);

      const error = await read;
      expect(DbTimeoutError.find(error)).toBeInstanceOf(DbTimeoutError);
    });

    it("releases a stalled read as soon as the unit's signal aborts", async ({
      expect,
    }) => {
      const { alepha, binding, app } = await d1({ DATABASE_TIMEOUT: 0 });
      binding.stalling = true;
      const unit = new AbortController();
      const reason = new AbortedError("client gone");

      const read = alepha.context
        .run(() => app.notes.findMany(), { signal: unit.signal })
        .catch((error: unknown) => error);
      await new Promise((r) => setTimeout(r, 10));
      unit.abort(reason);

      expect(await read).toBe(reason);
    });
  });
});
