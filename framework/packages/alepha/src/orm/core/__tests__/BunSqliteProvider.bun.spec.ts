import { afterEach, describe, expect, it } from "bun:test";

import { Alepha, z } from "alepha";

import {
  $entity,
  $repository,
  AlephaOrm,
  DatabaseProvider,
  db,
  DbForeignKeyError,
  sql,
} from "../index.ts";
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

const owners = $entity({
  name: "fk_owners",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    name: z.text(),
  }),
});

const pets = $entity({
  name: "fk_pets",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    ownerId: db.ref(z.integer(), () => owners.cols.id, { onDelete: "cascade" }),
    walkerId: db.ref(z.integer().optional(), () => owners.cols.id, {
      onDelete: "set null",
    }),
  }),
});

class TestApp {
  userRepo = $repository(users);
  postRepo = $repository(posts);
}

class ForeignKeyApp {
  owners = $repository(owners);
  pets = $repository(pets);
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

  it("runs an atomic batch all or nothing", async () => {
    setup();
    await alepha.start();
    const database = alepha.inject(DatabaseProvider);
    await database.execute(
      sql`CREATE TABLE atomic_bun (id INTEGER PRIMARY KEY, n INTEGER NOT NULL UNIQUE)`,
    );
    const rows = await database.atomicBatch([
      sql`INSERT INTO atomic_bun (id, n) VALUES (1, 1) RETURNING n`,
      sql`INSERT INTO atomic_bun (id, n) VALUES (2, 2) RETURNING n`,
    ]);
    expect(rows.map((it) => Number(it[0].n))).toEqual([1, 2]);
    const failed = await database
      .atomicBatch([
        sql`INSERT INTO atomic_bun (id, n) VALUES (3, 3)`,
        sql`INSERT INTO atomic_bun (id, n) VALUES (4, 1)`,
      ])
      .then(
        () => false,
        () => true,
      );
    expect(failed).toBe(true);
    const [{ n }] = await database.execute(
      sql`SELECT COUNT(*) AS n FROM atomic_bun`,
    );
    expect(Number(n)).toBe(2);
  });

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

    // Async callbacks must run entirely INSIDE the transaction: drizzle's
    // sync bun-sqlite driver would otherwise COMMIT before the awaited work
    // finishes, making rollback impossible.
    const error = await db
      .transactional(async () => {
        await app.userRepo.create({ name: "will-rollback" });
        await new Promise((resolve) => setTimeout(resolve, 10));
        await app.userRepo.create({ name: "will-rollback-too" });
        throw new Error("boom");
      })
      .then(
        () => undefined,
        (reason: unknown) => reason,
      );
    expect((error as Error | undefined)?.message).toBe("boom");

    expect(await app.userRepo.findMany()).toHaveLength(0);
  });

  it("should roll back async Repository.transaction work", async () => {
    const app = setup();
    await alepha.start();

    const error = await app.userRepo
      .transaction(async (tx) => {
        await app.userRepo.create({ name: "will-rollback" }, { tx: tx });
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error("boom");
      })
      .then(
        () => undefined,
        (reason: unknown) => reason,
      );
    expect((error as Error | undefined)?.message).toBe("boom");

    expect(await app.userRepo.findMany()).toHaveLength(0);
  });

  describe("foreign keys", () => {
    const boot = async () => {
      setup();
      const app = alepha.inject(ForeignKeyApp);
      await alepha.start();
      return app;
    };

    it("should open the connection with foreign keys enforced", async () => {
      await boot();
      const rows = await alepha
        .inject(DatabaseProvider)
        .execute("PRAGMA foreign_keys");
      expect(rows).toEqual([{ foreign_keys: 1 }]);
    });

    it("should refuse a reference to a row that does not exist", async () => {
      const app = await boot();

      const error = await app.pets.create({ ownerId: 999 }).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(DbForeignKeyError);
      expect(await app.pets.count()).toBe(0);
    });

    it("should cascade a delete and null an optional reference", async () => {
      const app = await boot();
      const owner = await app.owners.create({ name: "owner" });
      const walker = await app.owners.create({ name: "walker" });
      const other = await app.owners.create({ name: "other" });
      await app.pets.create({ ownerId: owner.id, walkerId: walker.id });
      await app.pets.create({ ownerId: other.id });

      await app.owners.deleteById(walker.id);
      expect((await app.pets.findMany({ orderBy: "id" }))[0]).toEqual({
        id: 1,
        ownerId: owner.id,
      } as any);

      await app.owners.deleteById(owner.id);
      expect((await app.pets.findMany()).map((it) => it.ownerId)).toEqual([
        other.id,
      ]);
    });
  });

  describe("url", () => {
    const provider = (env: Record<string, string>) =>
      Alepha.create({ env }).with(AlephaOrm).inject(BunSqliteProvider);

    it("should use an in-memory database under test", () => {
      expect(provider({ DATABASE_URL: "" }).url).toBe(":memory:");
    });

    it("should fall back to the scratch path in development", () => {
      expect(
        provider({ DATABASE_URL: "", NODE_ENV: "development", VITEST: "" }).url,
      ).toBe("node_modules/.alepha/bun-sqlite.db");
    });

    it("should refuse the scratch path in production", () => {
      expect(
        () =>
          provider({ DATABASE_URL: "", NODE_ENV: "production", VITEST: "" })
            .url,
      ).toThrow(/DATABASE_URL is required in production/);
    });

    it("should accept an explicit DATABASE_URL in production", () => {
      expect(
        provider({
          DATABASE_URL: "/var/lib/myapp/db.sqlite",
          NODE_ENV: "production",
          VITEST: "",
        }).url,
      ).toBe("/var/lib/myapp/db.sqlite");
    });

    it("should allow the scratch path for a migration run", () => {
      expect(
        provider({
          DATABASE_URL: "",
          NODE_ENV: "production",
          VITEST: "",
          MIGRATE: "true",
        }).url,
      ).toBe("node_modules/.alepha/bun-sqlite.db");
    });
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
