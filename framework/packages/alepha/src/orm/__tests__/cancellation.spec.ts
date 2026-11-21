import { $hook, AbortedError, Alepha, z } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import {
  $entity,
  $relations,
  $repository,
  DatabaseProvider,
  db,
  sql,
} from "../core/index.ts";
import {
  NodeSqliteProvider,
  nodeSqliteOptions,
} from "../core/providers/drivers/NodeSqliteProvider.ts";

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

  const comments = $entity({
    name: "cancellation_comments",
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
    const alepha = Alepha.create().with(AlephaOrmTestPostgres);
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

    it("refuses a relational read as it does a plain one", async ({
      expect,
    }) => {
      const { alepha, app } = await postgres();
      const signal = aborted();

      await expect(
        alepha.context.run(
          () => app.related.findMany({ include: { comments: true } }),
          { signal },
        ),
      ).rejects.toBe(signal.reason);
      await expect(
        alepha.context.run(
          () => app.related.findMany({ where: { comments: {} } }),
          { signal },
        ),
      ).rejects.toBe(signal.reason);
      expect(app.reads).toBe(0);
    });

    it("lets a relational read inside a transaction run despite the abort", async ({
      expect,
    }) => {
      const { alepha, app } = await postgres();
      const provider = alepha.inject(DatabaseProvider);
      const unit = new AbortController();

      const rows = await alepha.context.run(
        () =>
          provider.transactional(async () => {
            await app.notes.create({ title: "inside" });
            unit.abort(new AbortedError("client gone"));
            return app.related.findMany({ include: { comments: true } });
          }),
        { signal: unit.signal },
      );

      expect(rows.map((it) => it.title)).toEqual(["inside"]);
    });

    it("releases a running read's caller on abort, and lets Postgres finish the statement", async ({
      expect,
    }) => {
      const { alepha, app } = await postgres();
      // `pg_sleep` in the WHERE runs once per row.
      await app.notes.create({ title: "slow" });
      const unit = new AbortController();

      const startedAt = performance.now();
      const read = alepha.context.run(
        () => app.notes.count(sql`pg_sleep(1.25) is not null`),
        { signal: unit.signal },
      );
      const reason = new AbortedError("client gone");
      setTimeout(() => unit.abort(reason), 200);

      await expect(read).rejects.toBe(reason);
      expect(performance.now() - startedAt).toBeLessThan(1000);

      // Never cancelled (#Q3746): the statement is still running, alone.
      // `pg_stat_activity` is server-wide, so the count is scoped to this
      // instance's own test schema, which qualifies the table in the
      // statement text: another run of the suite sleeps on the same one.
      const database = alepha.inject(DatabaseProvider);
      const like = `%${database.schema}%pg_sleep(1.25)%`;
      const rows = await database.execute(
        sql`select count(*)::int as n from pg_stat_activity where state = 'active' and query like ${like} and pid <> pg_backend_pid()`,
      );
      expect(Number(rows[0].n)).toBe(1);
    });

    it("never lets an aborted read's cancel land on the next statement of its connection", async ({
      expect,
    }) => {
      // One connection, so the next statement is always on the backend an
      // abort used to cancel. A Postgres cancel names a backend, not a
      // statement: sent as the read ended, it interrupted whatever that
      // backend ran next, with 57014 (#Q3746).
      const alepha = Alepha.create({ env: { POOL_MAX: 1 } }).with(
        AlephaOrmTestPostgres,
      );
      const app = alepha.inject(App);
      await alepha.start();
      await app.notes.create({ title: "row" });

      let stray = 0;
      for (let i = 0; i < 150; i++) {
        const unit = new AbortController();
        const read = alepha.context.run(
          () => app.notes.count(sql`pg_sleep(0.005) is not null`),
          { signal: unit.signal },
        );
        // Around the moment the read ends: sometimes before, sometimes after.
        const timer = setTimeout(
          () => unit.abort(new AbortedError("client gone")),
          3 + Math.random() * 6,
        );
        await read.catch(() => undefined);
        clearTimeout(timer);

        // The next statement, under no signal at all: nothing may fail it.
        await app.notes.count(sql`pg_sleep(0.005) is not null`).catch(() => {
          stray++;
        });
      }

      expect(stray).toBe(0);
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

    it("refuses a relational read as it does a plain one", async ({
      expect,
    }) => {
      const { alepha, app } = await sqlite();
      const signal = aborted();

      await expect(
        alepha.context.run(
          () => app.related.findMany({ include: { comments: true } }),
          { signal },
        ),
      ).rejects.toBe(signal.reason);
      expect(app.reads).toBe(0);
    });
  });
});
