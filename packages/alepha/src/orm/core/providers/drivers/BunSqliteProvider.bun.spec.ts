import { afterEach, describe, expect, it } from "bun:test";
import { Alepha, t } from "alepha";
import { $entity, $repository, DatabaseProvider, db } from "../../index.ts";
import { BunSqliteProvider, bunSqliteOptions } from "./BunSqliteProvider.ts";

// -------------------------------------------------------------------------------------------------------------------

const users = $entity({
  name: "users",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    name: t.text(),
  }),
});

const posts = $entity({
  name: "posts",
  schema: t.object({
    id: db.primaryKey(t.bigint()),
    title: t.text(),
    body: t.optional(t.text()),
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
});
