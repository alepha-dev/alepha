import { afterEach, describe, expect, it } from "bun:test";
import { Alepha, z } from "alepha";
import { $entity, $repository, DatabaseProvider, db } from "alepha/orm";
import { BunPostgresProvider } from "../providers/BunPostgresProvider.ts";

// -------------------------------------------------------------------------------------------------------------------

const users = $entity({
  name: "users",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    name: z.text(),
    role: db.default(z.text(), "user"),
  }),
  indexes: [{ column: "name", unique: true }],
});

class TestApp {
  userRepo = $repository(users);
}

// -------------------------------------------------------------------------------------------------------------------

describe("BunPostgresProvider", () => {
  let alepha: Alepha;

  afterEach(async () => {
    await alepha?.stop().catch(() => {});
  });

  const setup = () => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:15432/postgres",
      },
    }).with({
      provide: DatabaseProvider,
      use: BunPostgresProvider,
    });

    return alepha.inject(TestApp);
  };

  it("should connect and disconnect cleanly", async () => {
    setup();
    await alepha.start();
    await alepha.stop();
  });

  it("should create and query entities", async () => {
    const app = setup();
    await alepha.start();

    const created = await app.userRepo.create({ name: "Alice" });
    expect(created.name).toBe("Alice");
    expect(created.role).toBe("user");
    expect(created.id).toBeDefined();
    expect(created.createdAt).toBeDefined();

    const found = await app.userRepo.findOne({
      where: { name: { eq: "Alice" } },
    });
    expect(found?.name).toBe("Alice");
  });

  it("should update entities with timestamp tracking", async () => {
    const app = setup();
    await alepha.start();

    const created = await app.userRepo.create({ name: "Bob" });

    await new Promise((r) => setTimeout(r, 5));

    const updated = await app.userRepo.updateOne(
      { name: { eq: "Bob" } },
      { role: "admin" },
    );

    expect(updated.role).toBe("admin");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
  });

  it("should delete entities", async () => {
    const app = setup();
    await alepha.start();

    await app.userRepo.create({ name: "Charlie" });

    await app.userRepo.deleteMany({ name: { eq: "Charlie" } });

    const found = await app.userRepo.findOne({
      where: { name: { eq: "Charlie" } },
    });
    expect(found).toBeFalsy();
  });

  it("should execute raw SQL", async () => {
    setup();
    await alepha.start();

    const db = alepha.inject(DatabaseProvider);
    const result = await db.execute("SELECT 1 as value");
    expect(result[0].value).toBe(1);
  });

  it("should report postgresql dialect", async () => {
    setup();
    await alepha.start();

    const db = alepha.inject(DatabaseProvider);
    expect(db.dialect).toBe("postgresql");
  });
});
