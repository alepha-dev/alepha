import { $hook, AbortedError, Alepha, z } from "alepha";
import { describe, it } from "vitest";

import {
  $entity,
  $repository,
  DatabaseProvider,
  db,
  sql,
} from "../core/index.ts";
import {
  NodeSqliteProvider,
  nodeSqliteOptions,
} from "../core/providers/drivers/NodeSqliteProvider.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

/**
 * Reads inherit the ambient signal; writes and transactions are never cut
 * short (#E85, owner decision 8).
 */
describe("ORM cancellation", () => {
  const notes = $entity({
    name: "cancellation_notes",
    schema: z.object({
      id: db.primaryKey(z.integer()),
      title: z.text(),
    }),
  });

  class App {
    notes = $repository(notes);
    provider = $repository(notes).provider;
    reads = 0;
    onRead = $hook({
      on: "repository:read:before",
      handler: () => {
        this.reads++;
      },
    });
  }

  const aborted = (message = "client gone") => {
    const controller = new AbortController();
    controller.abort(new AbortedError(message));
    return controller.signal;
  };

  const postgres = async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const app = alepha.inject(App);
    await alepha.start();
    return { alepha, app };
  };

  describe("PostgreSQL (postgres.js)", () => {
    it("refuses a read before sending it when the unit's signal already fired", async ({
      expect,
    }) => {
      const { alepha, app } = await postgres();
      const signal = aborted();

      await expect(
        alepha.context.run(() => app.notes.findMany(), { signal }),
      ).rejects.toBe(signal.reason);
      // Refused before the read even began.
      expect(app.reads).toBe(0);
    });

    it("cancels a running read on abort, and Postgres stops running it", async ({
      expect,
    }) => {
      const { alepha, app } = await postgres();
      // `pg_sleep` in the WHERE runs once per row.
      await app.notes.create({ title: "slow" });
      const unit = new AbortController();

      const startedAt = performance.now();
      const read = alepha.context.run(
        () => app.notes.count(sql`pg_sleep(3) is not null`),
        { signal: unit.signal },
      );
      const reason = new AbortedError("client gone");
      setTimeout(() => unit.abort(reason), 200);

      await expect(read).rejects.toBe(reason);
      expect(performance.now() - startedAt).toBeLessThan(2000);

      // The statement itself is gone from the server, not just abandoned.
      const deadline = Date.now() + 1500;
      let running = 1;
      while (Date.now() < deadline) {
        const rows = await alepha
          .inject(DatabaseProvider)
          .execute(
            sql`select count(*)::int as n from pg_stat_activity where state = 'active' and query like '%pg_sleep(3)%' and pid <> pg_backend_pid()`,
          );
        running = Number(rows[0].n);
        if (running === 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(running).toBe(0);
    });

    it("lets a read run to completion when nothing aborts", async ({
      expect,
    }) => {
      const { alepha, app } = await postgres();
      await app.notes.create({ title: "kept" });

      const rows = await alepha.context.run(() => app.notes.findMany(), {
        signal: new AbortController().signal,
      });
      expect(rows.map((it) => it.title)).toEqual(["kept"]);
    });

    it("lets a write outside a transaction ignore the ambient abort", async ({
      expect,
    }) => {
      const { alepha, app } = await postgres();

      await alepha.context.run(() => app.notes.create({ title: "written" }), {
        signal: aborted(),
      });

      expect((await app.notes.findMany()).map((it) => it.title)).toEqual([
        "written",
      ]);
    });

    it("refuses a write given an explicit signal that fired", async ({
      expect,
    }) => {
      const { app } = await postgres();
      const signal = aborted("caller gave up");

      await expect(
        app.notes.create({ title: "never" }, { signal }),
      ).rejects.toBe(signal.reason);
      expect(await app.notes.count()).toBe(0);
    });

    it("refuses a transaction before BEGIN when the unit's signal already fired", async ({
      expect,
    }) => {
      const { alepha, app } = await postgres();
      const provider = alepha.inject(DatabaseProvider);
      const signal = aborted();
      let ran = false;

      await expect(
        alepha.context.run(
          () =>
            provider.transactional(async () => {
              ran = true;
            }),
          { signal },
        ),
      ).rejects.toBe(signal.reason);
      expect(ran).toBe(false);
      expect(await app.notes.count()).toBe(0);
    });

    it("runs a begun transaction to commit despite an abort, reads included", async ({
      expect,
    }) => {
      const { alepha, app } = await postgres();
      const provider = alepha.inject(DatabaseProvider);
      const unit = new AbortController();

      const seen = await alepha.context.run(
        () =>
          provider.transactional(async () => {
            await app.notes.create({ title: "first" });
            unit.abort(new AbortedError("client gone"));
            // A read inside the transaction, after the abort.
            const count = await app.notes.count(sql`pg_sleep(0.2) is not null`);
            await app.notes.create({ title: "second" });
            return count;
          }),
        { signal: unit.signal },
      );

      expect(seen).toBe(1);
      expect(
        (await app.notes.findMany({ orderBy: "id" })).map((it) => it.title),
      ).toEqual(["first", "second"]);
    });
  });

  describe("SQLite (node:sqlite)", () => {
    const sqlite = async () => {
      const alepha = Alepha.create().with({
        provide: DatabaseProvider,
        use: NodeSqliteProvider,
      });
      alepha.store.mut(nodeSqliteOptions, (old) => ({
        ...old,
        path: "sqlite://:memory:",
      }));
      const app = alepha.inject(App);
      await alepha.start();
      return { alepha, app };
    };

    it("refuses a read before sending it, and lets a write through", async ({
      expect,
    }) => {
      const { alepha, app } = await sqlite();
      const signal = aborted();

      await expect(
        alepha.context.run(() => app.notes.findMany(), { signal }),
      ).rejects.toBe(signal.reason);

      await alepha.context.run(() => app.notes.create({ title: "written" }), {
        signal,
      });
      expect(await app.notes.count()).toBe(1);
    });
  });
});
