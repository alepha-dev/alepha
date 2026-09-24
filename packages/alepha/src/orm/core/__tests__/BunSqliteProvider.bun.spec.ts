import { afterEach, describe, expect, it } from "bun:test";

import { Alepha, z } from "alepha";

import { $entity, $repository, DatabaseProvider, db } from "../index.ts";
import {
  BunSqliteProvider,
  bunSqliteOptions,
} from "../providers/drivers/BunSqliteProvider.ts";

// -------------------------------------------------------------------------------------------------------------------

const users = $entity({
  name: "users",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    name: z.text(),
  }),
});

const posts = $entity({
  name: "posts",
  schema: z.object({
    id: db.primaryKey(z.bigint()),
    title: z.text(),
    body: z.text().optional(),
  }),
});

class TestApp {
  userRepo = $repository(users);
  postRepo = $repository(posts);
}

// -------------------------------------------------------------------------------------------------------------------

describe("BunSqliteProvider", () => {
  let alepha: Alepha;

  afterEach(async () => {
    await alepha?.stop().catch(() => {});
  });

  const setup = () => {
    alepha = Alepha.create().with({
      provide: DatabaseProvider,
      use: BunSqliteProvider,
    });

    alepha.store.mut(bunSqliteOptions, (old) => ({
      ...old,
      path: ":memory:",
    }));

    return alepha.inject(TestApp);
  };

  it("should start and stop cleanly", async () => {
    setup();
    await alepha.start();
    await alepha.stop();
  });

  it("should create and query entities", async () => {
    const app = setup();
    await alepha.start();

    await app.userRepo.create({ name: "Alice" });
    await app.userRepo.create({ name: "Bob" });

    const alice = await app.userRepo.findOne({
      where: { name: { eq: "Alice" } },
    });

    expect(alice).toEqual({ id: 1, name: "Alice" } as any);

    const all = await app.userRepo.findMany();
    expect(all).toHaveLength(2);
  });

  it("should support bigint primary keys", async () => {
    const app = setup();
    await alepha.start();

    await app.postRepo.create({ title: "First" });
    await app.postRepo.create({ title: "Second" });

    const post = await app.postRepo.findOne({
      where: { title: { eq: "First" } },
    });

    // bigint returns as string
    expect(post?.id).toBe("1");
    expect(post?.title).toBe("First");
  });

  it("should support update and delete", async () => {
    const app = setup();
    await alepha.start();

    await app.userRepo.create({ name: "Alice" });

    await app.userRepo.updateMany(
      { name: { eq: "Alice" } },
      { name: "Alice Updated" },
    );

    const updated = await app.userRepo.findOne({
      where: { name: { eq: "Alice Updated" } },
    });
    expect(updated?.name).toBe("Alice Updated");

    await app.userRepo.deleteMany({ name: { eq: "Alice Updated" } });

    const deleted = await app.userRepo.findOne({
      where: { name: { eq: "Alice Updated" } },
    });
    expect(deleted).toBeFalsy();
  });

  it("should roll back async transactional work", async () => {
    const app = setup();
    await alepha.start();

    const db = alepha.inject(DatabaseProvider);

    // Async callbacks must run entirely INSIDE the transaction — drizzle's
    // sync bun-sqlite driver would otherwise COMMIT before the awaited work
    // finishes, making rollback impossible.
    expect(
      db.transactional(async () => {
        await app.userRepo.create({ name: "will-rollback" });
        await new Promise((resolve) => setTimeout(resolve, 10));
        await app.userRepo.create({ name: "will-rollback-too" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await app.userRepo.findMany()).toHaveLength(0);
  });

  it("should roll back async Repository.transaction work", async () => {
    const app = setup();
    await alepha.start();

    expect(
      app.userRepo.transaction(async (tx) => {
        await app.userRepo.create({ name: "will-rollback" }, { tx: tx as any });
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await app.userRepo.findMany()).toHaveLength(0);
  });

  it("should execute raw SQL", async () => {
    setup();
    await alepha.start();

    const db = alepha.inject(DatabaseProvider);
    const result = await db.execute("SELECT 1 as value");
    expect(result).toEqual([{ value: 1 }]);
  });

  it("should expose native connection", async () => {
    setup();
    await alepha.start();

    const db = alepha.inject(DatabaseProvider);
    expect(db.nativeConnection).toBeDefined();
  });

  it("should report sqlite dialect", async () => {
    setup();
    await alepha.start();

    const db = alepha.inject(DatabaseProvider);
    expect(db.dialect).toBe("sqlite");
  });
  /**
   * #Q2516: one shared connection, so a statement from another request run
   * while a transaction awaited used to run inside it, and its rollback took
   * that write with it.
   */
  it("keeps a write made during a rolled-back transaction", async () => {
    const app = setup();
    await alepha.start();
    const provider = alepha.inject(DatabaseProvider);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let began!: () => void;
    const begun = new Promise<void>((resolve) => {
      began = resolve;
    });

    const a = alepha.context
      .run(() =>
        provider.transactional(async () => {
          await app.userRepo.create({ name: "from-a" });
          began();
          await held;
          throw new Error("A rolls back");
        }),
      )
      .catch(() => "rolled back");
    await begun;
    const bWrite = alepha.context.run(() =>
      app.userRepo.create({ name: "from-b" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    release();
    expect(await a).toBe("rolled back");
    await bWrite;

    const names = (await app.userRepo.findMany()).map((row) => row.name);
    expect(names).toEqual(["from-b"]);
  });
});
