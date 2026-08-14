import { $inject, $pipeline, type Alepha, createMiddleware, z } from "alepha";
import { expect } from "vitest";
import {
  $entity,
  $repository,
  $transactional,
  DatabaseProvider,
  db,
} from "../core/index.ts";

const item = $entity({
  name: "tx_mw_item",
  schema: z.object({
    id: db.primaryKey(z.integer(), {}, { mode: "byDefault" }),
    name: z.text(),
  }),
});

const $track = (log: string[], tag: string) =>
  createMiddleware({
    name: `$track:${tag}`,
    handler:
      ({ next }) =>
      async (...args: any[]) => {
        log.push(`${tag}:before`);
        const result = await next(...args);
        log.push(`${tag}:after`);
        return result;
      },
  });

export const testWrapsInTransaction = async (alepha: Alepha) => {
  class App {
    repo = $repository(item);

    createItems = $pipeline({
      use: [$transactional()],
      handler: async () => {
        await this.repo.create({ name: "a" });
        await this.repo.create({ name: "b" });
      },
    });
  }

  const app = alepha.inject(App);
  await alepha.start();

  await app.createItems();

  const items = await app.repo.findMany();
  expect(items).toHaveLength(2);
};

export const testRollbackOnError = async (alepha: Alepha) => {
  class App {
    repo = $repository(item);

    createAndFail = $pipeline({
      use: [$transactional()],
      handler: async () => {
        await this.repo.create({ name: "should-rollback" });
        throw new Error("boom");
      },
    });
  }

  const app = alepha.inject(App);
  await alepha.start();

  await expect(() => app.createAndFail()).rejects.toThrow("boom");

  const items = await app.repo.findMany();
  expect(items).toHaveLength(0);
};

export const testNesting = async (alepha: Alepha) => {
  class App {
    repo = $repository(item);

    inner = $pipeline({
      use: [$transactional()],
      handler: async () => {
        await this.repo.create({ name: "inner" });
      },
    });

    outer = $pipeline({
      use: [$transactional()],
      handler: async () => {
        await this.repo.create({ name: "outer" });
        await this.inner();
        throw new Error("rollback-all");
      },
    });
  }

  const app = alepha.inject(App);
  await alepha.start();

  await expect(() => app.outer()).rejects.toThrow("rollback-all");

  // Both "outer" and "inner" should be rolled back since inner reuses outer tx
  const items = await app.repo.findMany();
  expect(items).toHaveLength(0);
};

export const testComposeWithMiddleware = async (alepha: Alepha) => {
  const log: string[] = [];

  class App {
    repo = $repository(item);

    createItem = $pipeline({
      use: [$track(log, "track"), $transactional()],
      handler: async () => {
        log.push("handler");
        await this.repo.create({ name: "composed" });
      },
    });
  }

  const app = alepha.inject(App);
  await alepha.start();

  await app.createItem();

  expect(log).toStrictEqual(["track:before", "handler", "track:after"]);
  const items = await app.repo.findMany();
  expect(items).toHaveLength(1);
};

export const testBypassImplicitTx = async (alepha: Alepha) => {
  class App {
    repo = $repository(item);

    createAndFail = $pipeline({
      use: [$transactional()],
      handler: async () => {
        await this.repo.create({ name: "in-tx" });
        await this.repo.create({ name: "outside-tx" }, { tx: null });
        throw new Error("rollback");
      },
    });
  }

  const app = alepha.inject(App);
  await alepha.start();

  await expect(() => app.createAndFail()).rejects.toThrow("rollback");

  // "in-tx" should be rolled back, "outside-tx" should survive
  const items = await app.repo.findMany();
  expect(items).toHaveLength(1);
  expect(items[0].name).toBe("outside-tx");
};

export const testRepositoryTransactionAsyncRollback = async (
  alepha: Alepha,
) => {
  class App {
    repo = $repository(item);
  }

  const app = alepha.inject(App);
  await alepha.start();

  // The async callback must run entirely INSIDE the transaction: on sync
  // SQLite drivers a naive implementation commits before the awaited work
  // finishes, making rollback impossible.
  await expect(
    app.repo.transaction(async (tx) => {
      await app.repo.create({ name: "will-rollback" }, { tx: tx as any });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await app.repo.create({ name: "will-rollback-too" }, { tx: tx as any });
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");

  const items = await app.repo.findMany();
  expect(items).toHaveLength(0);
};

export const testConcurrentTransactionals = async (alepha: Alepha) => {
  class App {
    repo = $repository(item);
    db = $inject(DatabaseProvider);
  }

  const app = alepha.inject(App);
  await alepha.start();

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Two overlapping transactional blocks from separate contexts (like two
  // concurrent server requests). On a single shared SQLite connection they
  // must be serialized — not collide with "cannot start a transaction
  // within a transaction" or end each other's half-finished transaction.
  await Promise.all([
    alepha.fork(() =>
      app.db.transactional(async () => {
        await app.repo.create({ name: "t1" });
        await sleep(25);
        await app.repo.create({ name: "t1-bis" });
      }),
    ),
    alepha.fork(async () => {
      await sleep(5);
      return app.db.transactional(async () => {
        await app.repo.create({ name: "t2" });
        await sleep(5);
      });
    }),
  ]);

  const items = await app.repo.findMany();
  expect(items).toHaveLength(3);
};

export const testDatabaseProviderTransactional = async (alepha: Alepha) => {
  class App {
    repo = $repository(item);
    db = $inject(DatabaseProvider);
  }

  const app = alepha.inject(App);
  await alepha.start();

  await expect(
    app.db.transactional(async () => {
      await app.repo.create({ name: "will-rollback" });
      throw new Error("fail");
    }),
  ).rejects.toThrow("fail");

  const items = await app.repo.findMany();
  expect(items).toHaveLength(0);
};

export const testAfterCommitWaitsForOutermostCommit = async (
  alepha: Alepha,
) => {
  class App {
    repo = $repository(item);
    db = $inject(DatabaseProvider);
  }

  const app = alepha.inject(App);
  await alepha.start();

  const log: string[] = [];
  let txAtCallback: unknown = "not-run";
  let rowsAtCallback = -1;

  await app.db.transactional(async () => {
    await app.repo.create({ name: "outer" });

    // Joins the outer transaction — a callback registered here must wait for
    // the OUTERMOST commit, not fire when the inner block returns.
    await app.db.transactional(async () => {
      await app.db.afterCommit(async () => {
        log.push("callback");
        txAtCallback = alepha.get("alepha.orm.tx");
        rowsAtCallback = (await app.repo.findMany()).length;
      });
      log.push("inner:end");
    });

    log.push("outer:end");
  });

  expect(log).toStrictEqual(["inner:end", "outer:end", "callback"]);
  // The callback runs with no ambient transaction open ...
  expect(txAtCallback).toBeUndefined();
  // ... and therefore reads the committed row through a plain connection.
  expect(rowsAtCallback).toBe(1);
};

export const testAfterCommitDiscardedOnRollback = async (alepha: Alepha) => {
  class App {
    repo = $repository(item);
    db = $inject(DatabaseProvider);
  }

  const app = alepha.inject(App);
  await alepha.start();

  let ran = false;

  await expect(
    app.db.transactional(async () => {
      await app.repo.create({ name: "doomed" });
      await app.db.afterCommit(() => {
        ran = true;
      });
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");

  // Nothing committed, so the callback must never run.
  expect(ran).toBe(false);
  expect(await app.repo.findMany()).toHaveLength(0);
};

export const testAfterCommitIsolation = async (alepha: Alepha) => {
  class App {
    repo = $repository(item);
    db = $inject(DatabaseProvider);
  }

  const app = alepha.inject(App);
  await alepha.start();

  const events: string[] = [];

  // Overlapping transactions from separate contexts must each keep their own
  // callback queue: sharing one slot would let B's drain fire A's callback
  // while A's transaction is still open — the same single-slot failure the tx
  // marker itself once had. Gated on promises, not timers, so the overlap is
  // deterministic: A stays open until we release it.
  let releaseA: () => void = () => {};
  const holdA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });

  const a = alepha.fork(() =>
    app.db.transactional(async () => {
      await app.repo.create({ name: "a" });
      await app.db.afterCommit(() => {
        events.push("callback:a");
      });
      await holdA;
    }),
  );

  await alepha.fork(() =>
    app.db.transactional(async () => {
      await app.repo.create({ name: "b" });
      await app.db.afterCommit(() => {
        events.push("callback:b");
      });
    }),
  );

  // B has committed and drained; A is still open, so its callback must not
  // have fired — and must fire exactly once when A commits.
  expect(events).toStrictEqual(["callback:b"]);

  releaseA();
  await a;
  expect(events).toStrictEqual(["callback:b", "callback:a"]);
};

export const testAfterCommitWithoutTransaction = async (alepha: Alepha) => {
  class App {
    db = $inject(DatabaseProvider);
  }

  const app = alepha.inject(App);
  await alepha.start();

  let ran = false;
  await app.db.afterCommit(() => {
    ran = true;
  });

  // No transaction to wait for: the callback runs (and is awaited) in place.
  expect(ran).toBe(true);
};
