import { $inject, $pipeline, Alepha, createMiddleware, t } from "alepha";
import { describe, expect, test } from "vitest";
import {
  $entity,
  $repository,
  $transactional,
  DatabaseProvider,
  db,
} from "../index.ts";

const item = $entity({
  name: "tx_mw_item",
  schema: t.object({
    id: db.primaryKey(t.integer(), {}, { mode: "byDefault" }),
    name: t.text(),
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

describe("$transactional middleware", () => {
  test("should wrap handler in a database transaction", async () => {
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

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    await app.createItems();

    const items = await app.repo.findMany();
    expect(items).toHaveLength(2);
  });

  test("should rollback all operations on error", async () => {
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

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    await expect(() => app.createAndFail()).rejects.toThrow("boom");

    const items = await app.repo.findMany();
    expect(items).toHaveLength(0);
  });

  test("should support nesting (reuse outer tx)", async () => {
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

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    await expect(() => app.outer()).rejects.toThrow("rollback-all");

    // Both "outer" and "inner" should be rolled back since inner reuses outer tx
    const items = await app.repo.findMany();
    expect(items).toHaveLength(0);
  });

  test("should compose with other middleware", async () => {
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

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    await app.createItem();

    expect(log).toStrictEqual(["track:before", "handler", "track:after"]);
    const items = await app.repo.findMany();
    expect(items).toHaveLength(1);
  });

  test("tx: null should bypass implicit transaction", async () => {
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

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    await expect(() => app.createAndFail()).rejects.toThrow("rollback");

    // "in-tx" should be rolled back, "outside-tx" should survive
    const items = await app.repo.findMany();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("outside-tx");
  });

  test("DatabaseProvider.transactional() should work directly", async () => {
    class App {
      repo = $repository(item);
      db = $inject(DatabaseProvider);
    }

    const alepha = Alepha.create();
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
  });
});
