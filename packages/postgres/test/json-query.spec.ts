import { Alepha, t } from "@alepha/core";
import { describe, it } from "vitest";
import { $entity, $repository, pg } from "../src";

describe("Postgres JSON Query Tests", () => {
  const users = $entity({
    name: "users",
    schema: t.object({
      id: pg.primaryKey(),
      profile: t.object({
        name: t.text(),
        age: t.int(),
        contact: t.object({
          email: t.text(),
          phone: t.text(),
        }),
      }),
      addresses: t.array(
        t.object({
          street: t.text(),
          city: t.text(),
        }),
      ),
      tags: t.array(t.text()), // Simple string array
    }),
  });

  class App {
    users = $repository(users);
  }

  it("should query nested object property", async ({ expect }) => {
    const alepha = Alepha.create();
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
      addresses: [
        { street: "123 Main St", city: "Wonderland" },
        { street: "456 Side St", city: "Wonderland" },
      ],
      tags: [],
    });

    const u1 = await app.users.findOne({
      where: {
        profile: {
          name: { eq: "Alice" },
        },
      },
    });

    expect(u1.id).toBe(id);
  });

  it("should query deeply nested object (3 levels)", async ({ expect }) => {
    const alepha = Alepha.create();
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
      addresses: [],
      tags: [],
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
  });

  it("should query nested object with numeric comparison", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
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
      addresses: [],
      tags: [],
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
      addresses: [],
      tags: [],
    });

    const u1 = await app.users.findOne({
      where: {
        profile: {
          age: { gt: 60 },
        },
      },
    });

    expect(u1.id).toBe(id);
  });

  it("should query nested object with string pattern matching", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
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
      addresses: [],
      tags: [],
    });

    const u1 = await app.users.findOne({
      where: {
        profile: {
          name: { ilike: "%charlie%" },
        },
      },
    });

    expect(u1.id).toBe(id);
  });

  it("should query array elements", async ({ expect }) => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    const { id } = await app.users.create({
      profile: {
        name: "Array User",
        age: 40,
        contact: {
          email: "array@example.com",
          phone: "4444444444",
        },
      },
      addresses: [
        { street: "123 Main St", city: "Wonderland" },
        { street: "456 Side St", city: "Oz" },
      ],
      tags: [],
    });

    await app.users.create({
      profile: {
        name: "Other User",
        age: 50,
        contact: {
          email: "other@example.com",
          phone: "5555555555",
        },
      },
      addresses: [{ street: "789 Oak St", city: "Narnia" }],
      tags: [],
    });

    const u1 = await app.users.findOne({
      where: {
        addresses: {
          city: { eq: "Wonderland" },
        },
      },
    });

    expect(u1.id).toBe(id);
  });

  it("should query array elements with pattern matching", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    const { id } = await app.users.create({
      profile: {
        name: "Street User",
        age: 45,
        contact: {
          email: "street@example.com",
          phone: "6666666666",
        },
      },
      addresses: [
        { street: "123 Main Street", city: "Boston" },
        { street: "456 Oak Avenue", city: "Cambridge" },
      ],
      tags: [],
    });

    const u1 = await app.users.findOne({
      where: {
        addresses: {
          street: { like: "%Main%" },
        },
      },
    });

    expect(u1.id).toBe(id);
  });

  it("should support multiple nested conditions with AND", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
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
      addresses: [],
      tags: [],
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
      addresses: [],
      tags: [],
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
      addresses: [],
      tags: [],
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

  it("should support combining nested queries with top-level conditions", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    const { id: id1 } = await app.users.create({
      profile: {
        name: "Test User 1",
        age: 25,
        contact: {
          email: "test1@example.com",
          phone: "1010101010",
        },
      },
      addresses: [],
      tags: [],
    });

    const { id: id2 } = await app.users.create({
      profile: {
        name: "Test User 2",
        age: 35,
        contact: {
          email: "test2@example.com",
          phone: "2020202020",
        },
      },
      addresses: [],
      tags: [],
    });

    const u1 = await app.users.findOne({
      where: {
        id: { eq: id2 },
        profile: {
          age: { gte: 30 },
        },
      },
    });

    expect(u1.id).toBe(id2);
  });

  it("should handle null checks on nested properties", async ({ expect }) => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    const { id } = await app.users.create({
      profile: {
        name: "Null Test",
        age: 30,
        contact: {
          email: "null@example.com",
          phone: "3030303030",
        },
      },
      addresses: [],
      tags: [],
    });

    const u1 = await app.users.findOne({
      where: {
        profile: {
          contact: {
            email: { isNotNull: true },
          },
        },
      },
    });

    expect(u1.id).toBe(id);
  });

  it("should handle primitive string arrays with eq operator", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    // Create user without the tag
    await app.users.create({
      profile: {
        name: "No Tag User",
        age: 25,
        contact: {
          email: "notag@example.com",
          phone: "1111111111",
        },
      },
      addresses: [],
      tags: ["other", "different"],
    });

    // Create user with the tag
    const { id } = await app.users.create({
      profile: {
        name: "Tagged User",
        age: 30,
        contact: {
          email: "tagged@example.com",
          phone: "2222222222",
        },
      },
      addresses: [],
      tags: ["typescript", "postgres", "alepha"],
    });

    // Query for users with exact array match - should use native Drizzle operators
    const u1 = await app.users.findOne({
      where: {
        tags: { eq: ["typescript", "postgres", "alepha"] },
      },
    });

    expect(u1.id).toBe(id);
    expect(u1.tags).toEqual(["typescript", "postgres", "alepha"]);
  });

  it("should handle primitive arrays with arrayContains operator", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    // Create user without required tags
    await app.users.create({
      profile: {
        name: "User 1",
        age: 25,
        contact: {
          email: "user1@example.com",
          phone: "1111111111",
        },
      },
      addresses: [],
      tags: ["javascript", "react"],
    });

    // Create user with all required tags
    const { id } = await app.users.create({
      profile: {
        name: "User 2",
        age: 30,
        contact: {
          email: "user2@example.com",
          phone: "2222222222",
        },
      },
      addresses: [],
      tags: ["typescript", "postgres", "react", "nodejs"],
    });

    // Query for users who have ALL the specified tags
    const u1 = await app.users.findOne({
      where: {
        tags: { arrayContains: ["typescript", "postgres"] },
      },
    });

    expect(u1.id).toBe(id);
    expect(u1.tags).toContain("typescript");
    expect(u1.tags).toContain("postgres");
  });

  it("should handle primitive arrays with arrayContained operator", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    // Create user with tags not contained in the search set
    await app.users.create({
      profile: {
        name: "User 1",
        age: 25,
        contact: {
          email: "user1@example.com",
          phone: "1111111111",
        },
      },
      addresses: [],
      tags: ["typescript", "postgres", "python"],
    });

    // Create user whose tags ARE contained in the search set
    const { id } = await app.users.create({
      profile: {
        name: "User 2",
        age: 30,
        contact: {
          email: "user2@example.com",
          phone: "2222222222",
        },
      },
      addresses: [],
      tags: ["typescript", "postgres"],
    });

    // Query for users whose tags are a subset of the specified set
    const u1 = await app.users.findOne({
      where: {
        tags: { arrayContained: ["typescript", "postgres", "nodejs", "react"] },
      },
    });

    expect(u1.id).toBe(id);
    expect(u1.tags).toEqual(["typescript", "postgres"]);
  });

  it("should handle primitive arrays with arrayOverlaps operator", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    // Create user with no overlapping tags
    await app.users.create({
      profile: {
        name: "User 1",
        age: 25,
        contact: {
          email: "user1@example.com",
          phone: "1111111111",
        },
      },
      addresses: [],
      tags: ["python", "django"],
    });

    // Create user with some overlapping tags
    const { id } = await app.users.create({
      profile: {
        name: "User 2",
        age: 30,
        contact: {
          email: "user2@example.com",
          phone: "2222222222",
        },
      },
      addresses: [],
      tags: ["typescript", "react", "python"],
    });

    // Query for users who have AT LEAST ONE of the specified tags
    const u1 = await app.users.findOne({
      where: {
        tags: { arrayOverlaps: ["typescript", "postgres", "nodejs"] },
      },
    });

    expect(u1.id).toBe(id);
    expect(u1.tags).toContain("typescript");
  });
});
