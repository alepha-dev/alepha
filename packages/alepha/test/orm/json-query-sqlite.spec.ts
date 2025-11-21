import { Alepha, t } from "alepha";
import { describe, it } from "vitest";
import { $entity, $repository, pg } from "../../src/orm";
import { NodeSqliteProvider } from "../../src/orm/providers/drivers/NodeSqliteProvider";

describe("SQLite JSON Query Tests", () => {
  const users = $entity({
    name: "users",
    schema: t.object({
      id: pg.primaryKey(t.integer()),
      profile: t.object({
        name: t.text(),
        age: t.integer(),
        contact: t.object({
          email: t.text(),
          phone: t.text(),
        }),
      }),
    }),
  });

  class App {
    users = $repository(users);
  }

  it("should query nested object property with SQLite", async ({ expect }) => {
    const alepha = Alepha.create({
      "alepha.postgres.node-sqlite.options": {
        path: ":memory:",
      },
    }).with(NodeSqliteProvider);
    const app = alepha.inject(App);
    await alepha.start();

    const { id } = await app.users.create({
      profile: {
        name: "Alice",
        age: 30,
        contact: {
          email: "alice@example.com",
          phone: "1234567890",
        },
      },
    });

    const u1 = await app.users.findOne({
      where: {
        profile: {
          name: { eq: "Alice" },
        },
      },
    });

    expect(u1.id).toBe(id);
    expect(u1.profile.name).toBe("Alice");
  });

  it("should query nested object with numeric comparison (SQLite)", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      "alepha.postgres.node-sqlite.options": {
        path: ":memory:",
      },
    }).with(NodeSqliteProvider);
    const app = alepha.inject(App);
    await alepha.start();

    await app.users.create({
      profile: {
        name: "Young User",
        age: 18,
        contact: {
          email: "young@example.com",
          phone: "1111111111",
        },
      },
    });

    const { id } = await app.users.create({
      profile: {
        name: "Old User",
        age: 65,
        contact: {
          email: "old@example.com",
          phone: "2222222222",
        },
      },
    });

    const u1 = await app.users.findOne({
      where: {
        profile: {
          age: { gt: 60 },
        },
      },
    });

    expect(u1.id).toBe(id);
    expect(u1.profile.age).toBe(65);
  });

  it("should query deeply nested object (3 levels) with SQLite", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      "alepha.postgres.node-sqlite.options": {
        path: ":memory:",
      },
    }).with(NodeSqliteProvider);
    const app = alepha.inject(App);
    await alepha.start();

    const { id } = await app.users.create({
      profile: {
        name: "Bob",
        age: 25,
        contact: {
          email: "bob@example.com",
          phone: "9876543210",
        },
      },
    });

    const u1 = await app.users.findOne({
      where: {
        profile: {
          contact: {
            email: { eq: "bob@example.com" },
          },
        },
      },
    });

    expect(u1.id).toBe(id);
    expect(u1.profile.contact.email).toBe("bob@example.com");
  });

  it("should query with pattern matching (contains) using SQLite", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      "alepha.postgres.node-sqlite.options": {
        path: ":memory:",
      },
    }).with(NodeSqliteProvider);
    const app = alepha.inject(App);
    await alepha.start();

    const { id } = await app.users.create({
      profile: {
        name: "Charlie Brown",
        age: 35,
        contact: {
          email: "charlie@example.com",
          phone: "3333333333",
        },
      },
    });

    const u1 = await app.users.findOne({
      where: {
        profile: {
          name: { contains: "charlie" },
        },
      },
    });

    expect(u1.id).toBe(id);
  });

  it("should handle multiple nested conditions with SQLite", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      "alepha.postgres.node-sqlite.options": {
        path: ":memory:",
      },
    }).with(NodeSqliteProvider);
    const app = alepha.inject(App);
    await alepha.start();

    await app.users.create({
      profile: {
        name: "Wrong Name",
        age: 30,
        contact: {
          email: "wrong@example.com",
          phone: "7777777777",
        },
      },
    });

    await app.users.create({
      profile: {
        name: "Diana",
        age: 20,
        contact: {
          email: "diana@example.com",
          phone: "8888888888",
        },
      },
    });

    const { id } = await app.users.create({
      profile: {
        name: "Diana",
        age: 30,
        contact: {
          email: "diana30@example.com",
          phone: "9999999999",
        },
      },
    });

    const u1 = await app.users.findOne({
      where: {
        profile: {
          name: { eq: "Diana" },
          age: { eq: 30 },
        },
      },
    });

    expect(u1.id).toBe(id);
  });
});
