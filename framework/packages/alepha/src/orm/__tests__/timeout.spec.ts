import { AbortedError, Alepha, TimeoutError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import {
  $entity,
  $repository,
  DatabaseProvider,
  DbTimeoutError,
  db,
  sql,
} from "../core/index.ts";
import { FakeD1 } from "../core/providers/drivers/__tests__/fakeD1.ts";
import { CloudflareD1Provider } from "../core/providers/drivers/CloudflareD1Provider.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

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

  class App {
    notes = $repository(notes);
  }

  const boot = async (alepha: Alepha) => {
    const app = alepha.inject(App);
    await alepha.start();
    const time = alepha.inject(DateTimeProvider);
    time.pause();
    return { alepha, app, time };
  };

  /**
   * Wait, on the real clock, until postgres runs a statement matching `like`.
   */
  const running = async (alepha: Alepha, like: string): Promise<number> => {
    const rows = await alepha
      .inject(DatabaseProvider)
      .execute(
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
    it("fails a slow read with DbTimeoutError under travel(), and postgres stops running it", async ({
      expect,
    }) => {
      const { alepha, app, time } = await boot(
        Alepha.create().with(AlephaOrmPostgres),
      );
      await app.notes.create({ title: "slow" });

      const read = app.notes
        .count(sql`pg_sleep(4.1) is not null`, { timeout: [1, "seconds"] })
        .catch((error: unknown) => error);
      expect(
        await until(async () => (await running(alepha, "%pg_sleep(4.1)%")) > 0),
      ).toBe(true);
      await time.travel([1, "seconds"]);

      const error = await read;
      expect(error).toBeInstanceOf(DbTimeoutError);
      expect((error as DbTimeoutError).status).toBe(503);
      expect((error as Error).cause).toBeInstanceOf(TimeoutError);
      expect(
        await until(
          async () => (await running(alepha, "%pg_sleep(4.1)%")) === 0,
        ),
      ).toBe(true);
    });

    it("reads DATABASE_TIMEOUT as the default, and a statement's own timeout wins", async ({
      expect,
    }) => {
      const { alepha, app, time } = await boot(
        Alepha.create({ env: { DATABASE_TIMEOUT: 1000 } }).with(
          AlephaOrmPostgres,
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
        await until(async () => (await running(alepha, "%pg_sleep(4.2)%")) > 0),
      ).toBe(true);
      await time.travel([1, "seconds"]);

      expect(await bounded).toBeInstanceOf(DbTimeoutError);
      await unbounded;
      expect(opted).toBe(true);
    });

    it("never makes a write inherit the unit's signal through its timeout", async ({
      expect,
    }) => {
      const { alepha, app } = await boot(
        Alepha.create().with(AlephaOrmPostgres),
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
    it("has no default off serverless, and lets a timed statement finish", async ({
      expect,
    }) => {
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
