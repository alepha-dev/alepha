import { $hook, Alepha, t } from "@alepha/core";
import { describe, expect, it } from "vitest";
import { $repository, pg } from "../src";

class HookTracker {
  events: Array<{ name: string; data: any }> = [];

  clear() {
    this.events = [];
  }

  record(name: string, data: any) {
    this.events.push({ name, data });
  }

  find(name: string) {
    return this.events.filter((e) => e.name === name);
  }

  findLast(name: string) {
    const events = this.find(name);
    return events[events.length - 1];
  }
}

class App {
  tracker = new HookTracker();

  users = $repository({
    name: "users",
    schema: t.object({
      id: pg.primaryKey(),
      name: t.text(),
      email: t.text(),
    }),
  });

  // Hook: Create Before
  createBefore = $hook({
    on: "repository:create:before",
    handler: async ({ data, tableName }) => {
      this.tracker.record("create:before", { tableName, data });
    },
  });

  // Hook: Create After
  createAfter = $hook({
    on: "repository:create:after",
    handler: async ({ data, entity, tableName }) => {
      this.tracker.record("create:after", { tableName, data, entity });
    },
  });

  // Hook: Read Before
  readBefore = $hook({
    on: "repository:read:before",
    handler: async ({ query, tableName }) => {
      this.tracker.record("read:before", { tableName, query });
    },
  });

  // Hook: Read After
  readAfter = $hook({
    on: "repository:read:after",
    handler: async ({ query, entities, tableName }) => {
      this.tracker.record("read:after", { tableName, query, entities });
    },
  });

  // Hook: Update Before
  updateBefore = $hook({
    on: "repository:update:before",
    handler: async ({ where, data, tableName }) => {
      this.tracker.record("update:before", { tableName, where, data });
    },
  });

  // Hook: Update After
  updateAfter = $hook({
    on: "repository:update:after",
    handler: async ({ where, data, entities, tableName }) => {
      this.tracker.record("update:after", { tableName, where, data, entities });
    },
  });

  // Hook: Delete Before
  deleteBefore = $hook({
    on: "repository:delete:before",
    handler: async ({ where, tableName }) => {
      this.tracker.record("delete:before", { tableName, where });
    },
  });

  // Hook: Delete After
  deleteAfter = $hook({
    on: "repository:delete:after",
    handler: async ({ where, ids, tableName }) => {
      this.tracker.record("delete:after", { tableName, where, ids });
    },
  });
}

const testRepositoryHooks = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  // ========================================
  // CREATE HOOKS
  // ========================================

  // Test: create hook (single entity)
  app.tracker.clear();
  const user1 = await app.users.create({
    name: "Alice",
    email: "alice@example.com",
  });

  expect(app.tracker.find("create:before")).toHaveLength(1);
  expect(app.tracker.find("create:after")).toHaveLength(1);

  const createBeforeEvent = app.tracker.findLast("create:before");
  expect(createBeforeEvent.data.tableName).toBe("users");
  expect(createBeforeEvent.data.data.name).toBe("Alice");

  const createAfterEvent = app.tracker.findLast("create:after");
  expect(createAfterEvent.data.tableName).toBe("users");
  expect(createAfterEvent.data.entity.id).toBe(user1.id);
  expect(createAfterEvent.data.entity.name).toBe("Alice");

  // Test: createMany hook
  app.tracker.clear();
  const users = await app.users.createMany([
    { name: "Bob", email: "bob@example.com" },
    { name: "Charlie", email: "charlie@example.com" },
  ]);

  expect(app.tracker.find("create:before")).toHaveLength(1);
  expect(app.tracker.find("create:after")).toHaveLength(1);

  const createManyBeforeEvent = app.tracker.findLast("create:before");
  expect(createManyBeforeEvent.data.tableName).toBe("users");
  expect(createManyBeforeEvent.data.data).toHaveLength(2);

  const createManyAfterEvent = app.tracker.findLast("create:after");
  expect(createManyAfterEvent.data.tableName).toBe("users");
  expect(createManyAfterEvent.data.entity).toHaveLength(2);
  expect(createManyAfterEvent.data.entity[0].name).toBe("Bob");
  expect(createManyAfterEvent.data.entity[1].name).toBe("Charlie");

  // ========================================
  // READ HOOKS
  // ========================================

  // Test: find hook
  app.tracker.clear();
  const allUsers = await app.users.find();

  expect(app.tracker.find("read:before")).toHaveLength(1);
  expect(app.tracker.find("read:after")).toHaveLength(1);

  const readBeforeEvent = app.tracker.findLast("read:before");
  expect(readBeforeEvent.data.tableName).toBe("users");
  expect(readBeforeEvent.data.query).toBeDefined();

  const readAfterEvent = app.tracker.findLast("read:after");
  expect(readAfterEvent.data.tableName).toBe("users");
  expect(readAfterEvent.data.entities).toHaveLength(3);

  // Test: findOne hook (uses find internally)
  app.tracker.clear();
  await app.users.findOne({ where: { name: { eq: "Alice" } } });

  expect(app.tracker.find("read:before")).toHaveLength(1);
  expect(app.tracker.find("read:after")).toHaveLength(1);

  // Test: findById hook (uses find internally)
  app.tracker.clear();
  await app.users.findById(user1.id);

  expect(app.tracker.find("read:before")).toHaveLength(1);
  expect(app.tracker.find("read:after")).toHaveLength(1);

  // Test: paginate hook (uses find internally)
  app.tracker.clear();
  await app.users.paginate({ page: 0, size: 10 });

  // paginate calls find once
  expect(app.tracker.find("read:before")).toHaveLength(1);
  expect(app.tracker.find("read:after")).toHaveLength(1);

  // ========================================
  // UPDATE HOOKS
  // ========================================

  // Test: updateOne hook
  app.tracker.clear();
  await app.users.updateOne(
    { id: { eq: user1.id } },
    { name: "Alice Updated" },
  );

  expect(app.tracker.find("update:before")).toHaveLength(1);
  expect(app.tracker.find("update:after")).toHaveLength(1);

  const updateBeforeEvent = app.tracker.findLast("update:before");
  expect(updateBeforeEvent.data.tableName).toBe("users");
  expect(updateBeforeEvent.data.data.name).toBe("Alice Updated");

  const updateAfterEvent = app.tracker.findLast("update:after");
  expect(updateAfterEvent.data.tableName).toBe("users");
  expect(updateAfterEvent.data.entities).toHaveLength(1);
  expect(updateAfterEvent.data.entities[0].name).toBe("Alice Updated");

  // Test: updateById hook (uses updateOne internally)
  app.tracker.clear();
  await app.users.updateById(user1.id, { email: "alice.new@example.com" });

  expect(app.tracker.find("update:before")).toHaveLength(1);
  expect(app.tracker.find("update:after")).toHaveLength(1);

  // Test: updateMany hook
  app.tracker.clear();
  const allBeforeUpdate = await app.users.find();
  const bobAndCharlie = allBeforeUpdate.filter(
    (u) => u.name === "Bob" || u.name === "Charlie",
  );
  await app.users.updateMany(
    {
      or: [{ name: { eq: "Bob" } }, { name: { eq: "Charlie" } }],
    },
    { email: "updated@example.com" },
  );

  expect(app.tracker.find("update:before")).toHaveLength(1);
  expect(app.tracker.find("update:after")).toHaveLength(1);

  const updateManyAfterEvent = app.tracker.findLast("update:after");
  expect(updateManyAfterEvent.data.entities.length).toBeGreaterThanOrEqual(2);

  // Test: save hook (uses updateOne internally)
  app.tracker.clear();
  const userToSave = await app.users.findById(user1.id);
  userToSave.name = "Alice Saved";
  await app.users.save(userToSave);

  // save calls find (read) once, and updateOne (update) once
  expect(app.tracker.find("read:before").length).toBeGreaterThanOrEqual(1);
  expect(app.tracker.find("read:after").length).toBeGreaterThanOrEqual(1);
  expect(app.tracker.find("update:before")).toHaveLength(1);
  expect(app.tracker.find("update:after")).toHaveLength(1);

  // ========================================
  // DELETE HOOKS
  // ========================================

  // Test: deleteMany hook
  app.tracker.clear();
  const bobUser = bobAndCharlie.find((u) => u.name === "Bob");
  if (!bobUser) throw new Error("Bob not found");

  await app.users.deleteMany({ id: { eq: bobUser.id } });

  expect(app.tracker.find("delete:before")).toHaveLength(1);
  expect(app.tracker.find("delete:after")).toHaveLength(1);

  const deleteBeforeEvent = app.tracker.findLast("delete:before");
  expect(deleteBeforeEvent.data.tableName).toBe("users");

  const deleteAfterEvent = app.tracker.findLast("delete:after");
  expect(deleteAfterEvent.data.tableName).toBe("users");
  expect(deleteAfterEvent.data.ids).toHaveLength(1);
  expect(deleteAfterEvent.data.ids[0]).toBe(bobUser.id);

  // Test: deleteOne hook (uses deleteMany internally)
  app.tracker.clear();
  const charlieUser = bobAndCharlie.find((u) => u.name === "Charlie");
  if (!charlieUser) throw new Error("Charlie not found");

  await app.users.deleteOne({ id: { eq: charlieUser.id } });

  expect(app.tracker.find("delete:before")).toHaveLength(1);
  expect(app.tracker.find("delete:after")).toHaveLength(1);

  // Test: deleteById hook (uses deleteMany internally)
  app.tracker.clear();
  const remainingUsers = await app.users.find();
  const lastUser = remainingUsers[0];

  await app.users.deleteById(lastUser.id);

  expect(app.tracker.find("delete:before")).toHaveLength(1);
  expect(app.tracker.find("delete:after")).toHaveLength(1);

  // ========================================
  // HOOK ORDER VERIFICATION
  // ========================================

  // Test: hooks fire in correct order (before -> after)
  app.tracker.clear();
  await app.users.create({ name: "Test", email: "test@example.com" });

  const allEvents = app.tracker.events.map((e) => e.name);
  const createBeforeIndex = allEvents.indexOf("create:before");
  const createAfterIndex = allEvents.indexOf("create:after");

  expect(createBeforeIndex).toBeLessThan(createAfterIndex);
};

describe("$repository - Hooks", () => {
  it("should fire hooks for all operations (postgres)", async () => {
    await testRepositoryHooks(Alepha.create());
  });

  it("should fire hooks for all operations (pglite)", async () => {
    process.env.DATABASE_URL = "pglite://:memory:";
    await testRepositoryHooks(Alepha.create());
  });

  it("should fire hooks for all operations (sqlite)", async () => {
    process.env.DATABASE_URL = "sqlite://:memory:";
    await testRepositoryHooks(Alepha.create());
  });
});
