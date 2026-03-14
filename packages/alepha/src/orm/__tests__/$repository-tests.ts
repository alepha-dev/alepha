import { $hook, type Alepha, type Static, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { expect } from "vitest";
import { DbEntityNotFoundError } from "../core/errors/DbEntityNotFoundError.ts";
import { $entity, $repository, db } from "../core/index.ts";
import { bigEntity } from "./fixtures/bigEntitySchema.ts";
import type { InsertUserEntity } from "./fixtures/userEntitySchema.ts";
import { userEntity } from "./fixtures/userEntitySchema.ts";

// ============================================================================
// Shared entity definitions for multiple tests
// ============================================================================

class PgAttrApp {
  users = $repository(userEntity);
  big = $repository(bigEntity);
  create = (data: InsertUserEntity) => this.users.create(data);
}

// ============================================================================
// testPgAttr
// ============================================================================

export const testPgAttr = async (alepha: Alepha) => {
  const app = alepha.inject(PgAttrApp);
  await alepha.start();

  const entity = await app.users.create({
    suspect: "hey",
    name: "John",
    profile: {
      age: 30,
    },
  } as any);

  expect((entity as any).suspect).toBeUndefined();
  expect(entity.name).toEqual("John");
  expect(entity.profile.age).toEqual(30);
};

// ============================================================================
// testAllTypes
// ============================================================================

export const testAllTypes = async (alepha: Alepha) => {
  const app = alepha.inject(PgAttrApp);
  await alepha.start();

  const data: Static<typeof bigEntity.insertSchema> = {
    type: "big_entity",
    a: "a",
    b: 1.111,
    date: "2024-01-01",
    c: 2,
    d: true,
    e: {
      a: "a",
      b: 1,
      c: 2,
      d: true,
      e: {
        a: "a",
        b: 1,
        c: 2,
        d: true,
        j: [
          {
            a: "a",
            b: 1,
            c: 2,
            d: true,
            e: {
              a: "a",
              b: 1,
              c: 2,
              d: true,
            },
          },
        ],
      },
    },
    f: ["a", "b"],
    g: [1.111],
    h: [2, 1],
    i: [true],
    j: [
      {
        a: "a",
        b: 1,
        c: 2,
        d: true,
        e: {
          a: "a",
          b: 1,
          c: 2,
          d: true,
        },
      },
    ],
    k: alepha.inject(DateTimeProvider).nowISOString(),
    l: "123e4567-e89b-12d3-a456-426614174000",
    m: "a" as const,
  };
  const entity = await app.big.create(data);

  expect(entity).toEqual({
    id: entity.id,
    ...data,
  });

  const it = await app.big.findMany({
    where: {
      type: "big_entity",
    },
  });

  expect(it).toHaveLength(1);
};

// ============================================================================
// testBasicCrud
// ============================================================================

class CrudApp {
  users = $repository(
    $entity({
      name: "users",
      schema: t.object({
        id: db.primaryKey(),
        createdAt: db.createdAt(),
        updatedAt: db.updatedAt(),
        name: t.text(),
        profile: t.object({
          age: t.number(),
        }),
        role: db.default(t.text(), "user"),
      }),
    }),
  );
}

export const testBasicCrud = async (alepha: Alepha) => {
  const app = alepha.inject(CrudApp);
  await alepha.start();

  // ========================================
  // CREATE OPERATIONS
  // ========================================

  // Test: create single entity
  const createdUser = await app.users.create({
    name: "Alice",
    profile: { age: 30 },
    role: "admin",
  });

  expect(createdUser.id).toBeDefined();
  expect(createdUser.name).toBe("Alice");
  expect(createdUser.profile?.age).toBe(30);
  expect(createdUser.role).toBe("admin");

  const aliceId = createdUser.id;

  // Test: createMany
  const manyUsers: InsertUserEntity[] = [
    { name: "Bob", profile: { age: 25 }, role: "user" },
    { name: "Charlie", profile: { age: 35 }, role: "admin" },
    { name: "David", profile: { age: 28 }, role: "user" },
    { name: "Eve", profile: { age: 32 }, role: "moderator" },
  ];

  const createdMany = await app.users.createMany(manyUsers);
  expect(createdMany).toHaveLength(4);
  expect(createdMany[0].name).toBe("Bob");
  expect(createdMany[1].name).toBe("Charlie");
  expect(createdMany[2].name).toBe("David");
  expect(createdMany[3].name).toBe("Eve");

  // Test: createMany with empty array
  const emptyResult = await app.users.createMany([]);
  expect(emptyResult).toHaveLength(0);

  // ========================================
  // FIND OPERATIONS
  // ========================================

  // Test: find all
  const allUsers = await app.users.findMany();
  expect(allUsers).toHaveLength(5);

  // Test: find with where clause (exact match)
  const adminUsers = await app.users.findMany({
    where: { role: { eq: "admin" } },
  });
  expect(adminUsers).toHaveLength(2);
  expect(adminUsers.every((u) => u.role === "admin")).toBe(true);

  // Test: find with limit
  const limitedUsers = await app.users.findMany({ limit: 2 });
  expect(limitedUsers).toHaveLength(2);

  // Test: find with offset
  const offsetUsers = await app.users.findMany({ offset: 3 });
  expect(offsetUsers).toHaveLength(2);

  // Test: find with limit and offset
  const paginatedUsers = await app.users.findMany({ limit: 2, offset: 1 });
  expect(paginatedUsers).toHaveLength(2);

  // Test: findOne (returns undefined when not found)
  const foundAlice = await app.users.findOne({
    where: { name: { eq: "Alice" } },
  });
  expect(foundAlice).toBeDefined();
  expect(foundAlice!.id).toBe(aliceId);
  expect(foundAlice!.name).toBe("Alice");

  // Test: findOne returns undefined when not found
  const notFound = await app.users.findOne({
    where: { name: { eq: "NonExistent" } },
  });
  expect(notFound).toBeUndefined();

  // Test: getOne throws when not found
  await expect(
    app.users.getOne({ where: { name: { eq: "NonExistent" } } }),
  ).rejects.toThrowError(DbEntityNotFoundError);

  // Test: findById (returns undefined when not found)
  const userById = await app.users.findById(aliceId);
  expect(userById).toBeDefined();
  expect(userById!.id).toBe(aliceId);
  expect(userById!.name).toBe("Alice");

  // Test: findById returns undefined when not found
  const notFoundById = await app.users.findById(999999);
  expect(notFoundById).toBeUndefined();

  // Test: getById throws when not found
  await expect(app.users.getById(999999)).rejects.toThrowError(
    DbEntityNotFoundError,
  );

  // ========================================
  // COUNT OPERATIONS
  // ========================================

  // Test: count all
  const totalCount = await app.users.count();
  expect(totalCount).toBe(5);

  // Test: count with where clause
  const adminCount = await app.users.count({ role: { eq: "admin" } });
  expect(adminCount).toBe(2);

  const userCount = await app.users.count({ role: { eq: "user" } });
  expect(userCount).toBe(2);

  const moderatorCount = await app.users.count({ role: { eq: "moderator" } });
  expect(moderatorCount).toBe(1);

  // ========================================
  // UPDATE OPERATIONS
  // ========================================

  // Test: updateOne
  const updatedAlice = await app.users.updateOne(
    { id: { eq: aliceId } },
    { name: "Alice Updated", role: "admin" }, // Keep role since defaults apply
  );
  expect(updatedAlice.id).toBe(aliceId);
  expect(updatedAlice.name).toBe("Alice Updated");
  expect(updatedAlice.role).toBe("admin");

  // Test: updateOne throws when not found
  await expect(
    app.users.updateOne({ id: { eq: 999999 } }, { name: "Should Fail" }),
  ).rejects.toThrowError(DbEntityNotFoundError);

  // Test: updateById
  const updatedByIdAlice = await app.users.updateById(aliceId, {
    role: "superadmin",
  });
  expect(updatedByIdAlice.id).toBe(aliceId);
  expect(updatedByIdAlice.role).toBe("superadmin");
  expect(updatedByIdAlice.name).toBe("Alice Updated"); // Previous update persisted

  // Verify update persisted
  const verifyAlice = await app.users.getById(aliceId);
  expect(verifyAlice.name).toBe("Alice Updated");
  expect(verifyAlice.role).toBe("superadmin");

  // Test: updateMany
  const updatedUserIds = await app.users.updateMany(
    { role: { eq: "user" } },
    { role: "member" },
  );
  expect(updatedUserIds).toHaveLength(2);

  // Verify updateMany worked
  const members = await app.users.findMany({
    where: { role: { eq: "member" } },
  });
  expect(members).toHaveLength(2);
  expect(members.every((u) => u.role === "member")).toBe(true);

  // Test: save
  const userToSave = await app.users.getOne({
    where: { name: { eq: "Charlie" } },
  });
  userToSave.name = "Charlie Saved";
  userToSave.profile = { age: 36 };
  await app.users.save(userToSave);

  const savedUser = await app.users.getById(userToSave.id);
  expect(savedUser.name).toBe("Charlie Saved");
  expect(savedUser.profile?.age).toBe(36);

  // ========================================
  // DELETE OPERATIONS
  // ========================================

  // Test: deleteOne
  const bob = await app.users.getOne({ where: { name: { eq: "Bob" } } });
  const deletedOneIds = await app.users.deleteOne({ id: { eq: bob.id } });
  expect(deletedOneIds).toHaveLength(1);
  expect(deletedOneIds[0]).toBe(bob.id);

  // Verify bob is deleted
  const usersAfterDeleteOne = await app.users.findMany();
  expect(usersAfterDeleteOne).toHaveLength(4);
  expect(usersAfterDeleteOne.every((u) => u.name !== "Bob")).toBe(true);

  // Test: deleteById
  const eve = await app.users.getOne({ where: { name: { eq: "Eve" } } });
  const deletedByIdResult = await app.users.deleteById(eve.id);
  expect(deletedByIdResult).toHaveLength(1);
  expect(deletedByIdResult[0]).toBe(eve.id);

  // Test: deleteById throws when not found
  await expect(app.users.deleteById(999999)).rejects.toThrowError(
    DbEntityNotFoundError,
  );

  // Verify eve is deleted
  const usersAfterDeleteById = await app.users.findMany();
  expect(usersAfterDeleteById).toHaveLength(3);

  // Test: destroy (delete by entity)
  const david = await app.users.getOne({ where: { name: { eq: "David" } } });
  const destroyedIds = await app.users.destroy(david);
  expect(destroyedIds).toHaveLength(1);
  expect(destroyedIds[0]).toBe(david.id);

  // Verify david is deleted
  const usersAfterDestroy = await app.users.findMany();
  expect(usersAfterDestroy).toHaveLength(2);

  // Test: deleteMany
  const deletedManyIds = await app.users.deleteMany({
    role: { eq: "superadmin" },
  });
  expect(deletedManyIds).toHaveLength(1);
  expect(deletedManyIds[0]).toBe(aliceId);

  // Verify only Charlie remains
  const remainingUsers = await app.users.findMany();
  expect(remainingUsers).toHaveLength(1);
  expect(remainingUsers[0].name).toBe("Charlie Saved");

  // Test: clear (delete all)
  await app.users.createMany([
    { name: "Test1", profile: { age: 20 }, role: "user" },
    { name: "Test2", profile: { age: 21 }, role: "user" },
    { name: "Test3", profile: { age: 22 }, role: "admin" },
  ]);

  const beforeClearCount = await app.users.count();
  expect(beforeClearCount).toBe(4);

  const clearedIds = await app.users.clear({ force: true });
  expect(clearedIds).toHaveLength(4);

  const afterClearCount = await app.users.count();
  expect(afterClearCount).toBe(0);

  const emptyFind = await app.users.findMany();
  expect(emptyFind).toHaveLength(0);
};

// ============================================================================
// testRepositoryHooks
// ============================================================================

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

class HooksApp {
  tracker = new HookTracker();

  users = $repository(
    $entity({
      name: "users",
      schema: t.object({
        id: db.primaryKey(),
        name: t.text(),
        email: t.text(),
      }),
    }),
  );

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

export const testRepositoryHooks = async (alepha: Alepha) => {
  const app = alepha.inject(HooksApp);
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
  const allUsers = await app.users.findMany();

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
  const allBeforeUpdate = await app.users.findMany();
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
  const userToSave = await app.users.getById(user1.id);
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
  const remainingUsers = await app.users.findMany();
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

// ============================================================================
// testOrderByModes
// ============================================================================

class OrderByApp {
  users = $repository(userEntity);
}

export const testOrderByModes = async (alepha: Alepha) => {
  const app = alepha.inject(OrderByApp);
  await alepha.start();

  // Create test users with different names and roles
  const users: InsertUserEntity[] = [
    { name: "Charlie", profile: { age: 25 }, role: "admin" },
    { name: "Alice", profile: { age: 30 }, role: "user" },
    { name: "Bob", profile: { age: 20 }, role: "admin" },
    { name: "David", profile: { age: 35 }, role: "user" },
  ];

  for (const user of users) {
    await app.users.create(user);
  }

  // MODE 1: String (defaults to ASC)
  const usersMode1 = await app.users.findMany({
    orderBy: "name",
  });

  expect(usersMode1.length).toBe(4);
  expect(usersMode1[0].name).toBe("Alice");
  expect(usersMode1[1].name).toBe("Bob");
  expect(usersMode1[2].name).toBe("Charlie");
  expect(usersMode1[3].name).toBe("David");

  // MODE 2: Single object with direction ASC
  const usersMode2Asc = await app.users.findMany({
    orderBy: { column: "name", direction: "asc" },
  });

  expect(usersMode2Asc.length).toBe(4);
  expect(usersMode2Asc[0].name).toBe("Alice");
  expect(usersMode2Asc[1].name).toBe("Bob");
  expect(usersMode2Asc[2].name).toBe("Charlie");
  expect(usersMode2Asc[3].name).toBe("David");

  // MODE 2: Single object with direction DESC
  const usersMode2Desc = await app.users.findMany({
    orderBy: { column: "name", direction: "desc" },
  });

  expect(usersMode2Desc.length).toBe(4);
  expect(usersMode2Desc[0].name).toBe("David");
  expect(usersMode2Desc[1].name).toBe("Charlie");
  expect(usersMode2Desc[2].name).toBe("Bob");
  expect(usersMode2Desc[3].name).toBe("Alice");

  // MODE 2: Single object without direction (defaults to ASC)
  const usersMode2Default = await app.users.findMany({
    orderBy: { column: "name" },
  });

  expect(usersMode2Default.length).toBe(4);
  expect(usersMode2Default[0].name).toBe("Alice");
  expect(usersMode2Default[3].name).toBe("David");

  // MODE 3: Array with multiple columns
  const usersMode3Multi = await app.users.findMany({
    orderBy: [
      { column: "role", direction: "asc" },
      { column: "name", direction: "desc" },
    ],
  });

  expect(usersMode3Multi.length).toBe(4);
  // First by role ASC (admin, admin, user, user)
  // Then by name DESC within each role
  expect(usersMode3Multi[0].role).toBe("admin");
  expect(usersMode3Multi[0].name).toBe("Charlie"); // admin, Charlie
  expect(usersMode3Multi[1].role).toBe("admin");
  expect(usersMode3Multi[1].name).toBe("Bob"); // admin, Bob
  expect(usersMode3Multi[2].role).toBe("user");
  expect(usersMode3Multi[2].name).toBe("David"); // user, David
  expect(usersMode3Multi[3].role).toBe("user");
  expect(usersMode3Multi[3].name).toBe("Alice"); // user, Alice

  // MODE 3: Array with default direction
  const usersMode3Default = await app.users.findMany({
    orderBy: [{ column: "role" }, { column: "name" }],
  });

  expect(usersMode3Default.length).toBe(4);
  // Both ASC by default
  expect(usersMode3Default[0].role).toBe("admin");
  expect(usersMode3Default[0].name).toBe("Bob"); // admin, Bob
  expect(usersMode3Default[1].role).toBe("admin");
  expect(usersMode3Default[1].name).toBe("Charlie"); // admin, Charlie

  // MODE 3: Array with single column
  const usersMode3Single = await app.users.findMany({
    orderBy: [{ column: "name", direction: "desc" }],
  });

  expect(usersMode3Single.length).toBe(4);
  expect(usersMode3Single[0].name).toBe("David");
  expect(usersMode3Single[3].name).toBe("Alice");

  // Clean up
  await app.users.clear({ force: true });
};

// ============================================================================
// testPaginationSort
// ============================================================================

class PaginationSortApp {
  users = $repository(userEntity);
}

export const testPaginationSort = async (alepha: Alepha) => {
  const app = alepha.inject(PaginationSortApp);
  await alepha.start();

  // Create test users with different names and roles
  const users: InsertUserEntity[] = [
    { name: "Charlie", profile: { age: 25 }, role: "admin" },
    { name: "Alice", profile: { age: 30 }, role: "user" },
    { name: "Bob", profile: { age: 20 }, role: "admin" },
    { name: "David", profile: { age: 35 }, role: "user" },
  ];

  for (const user of users) {
    await app.users.create(user);
  }

  // Test 1: Single column ASC (no prefix)
  const result1 = await app.users.paginate({ sort: "name" });

  expect(result1.content.length).toBe(4);
  expect(result1.content[0].name).toBe("Alice");
  expect(result1.content[1].name).toBe("Bob");
  expect(result1.content[2].name).toBe("Charlie");
  expect(result1.content[3].name).toBe("David");

  // Test 2: Single column DESC (with - prefix)
  const result2 = await app.users.paginate({ sort: "-name" });

  expect(result2.content.length).toBe(4);
  expect(result2.content[0].name).toBe("David");
  expect(result2.content[1].name).toBe("Charlie");
  expect(result2.content[2].name).toBe("Bob");
  expect(result2.content[3].name).toBe("Alice");

  // Test 3: Multiple columns - role ASC, name DESC
  const result3 = await app.users.paginate({ sort: "role,-name" });

  expect(result3.content.length).toBe(4);
  // First by role ASC (admin, admin, user, user)
  // Then by name DESC within each role
  expect(result3.content[0].role).toBe("admin");
  expect(result3.content[0].name).toBe("Charlie"); // admin, Charlie
  expect(result3.content[1].role).toBe("admin");
  expect(result3.content[1].name).toBe("Bob"); // admin, Bob
  expect(result3.content[2].role).toBe("user");
  expect(result3.content[2].name).toBe("David"); // user, David
  expect(result3.content[3].role).toBe("user");
  expect(result3.content[3].name).toBe("Alice"); // user, Alice

  // Test 4: Multiple columns - both ASC
  const result4 = await app.users.paginate({ sort: "role,name" });

  expect(result4.content.length).toBe(4);
  // Both ASC
  expect(result4.content[0].role).toBe("admin");
  expect(result4.content[0].name).toBe("Bob"); // admin, Bob
  expect(result4.content[1].role).toBe("admin");
  expect(result4.content[1].name).toBe("Charlie"); // admin, Charlie
  expect(result4.content[2].role).toBe("user");
  expect(result4.content[2].name).toBe("Alice"); // user, Alice
  expect(result4.content[3].role).toBe("user");
  expect(result4.content[3].name).toBe("David"); // user, David

  // Test 5: Multiple columns - both DESC
  const result5 = await app.users.paginate({ sort: "-role,-name" });

  expect(result5.content.length).toBe(4);
  // Both DESC
  expect(result5.content[0].role).toBe("user");
  expect(result5.content[0].name).toBe("David"); // user, David
  expect(result5.content[1].role).toBe("user");
  expect(result5.content[1].name).toBe("Alice"); // user, Alice
  expect(result5.content[2].role).toBe("admin");
  expect(result5.content[2].name).toBe("Charlie"); // admin, Charlie
  expect(result5.content[3].role).toBe("admin");
  expect(result5.content[3].name).toBe("Bob"); // admin, Bob

  // Test 6: Pagination with sorting and page size
  const result6 = await app.users.paginate(
    { sort: "name", size: 2, page: 0 },
    {},
    { count: true },
  );

  expect(result6.content.length).toBe(2);
  expect(result6.content[0].name).toBe("Alice");
  expect(result6.content[1].name).toBe("Bob");
  expect(result6.page.totalElements).toBe(4);
  expect(result6.page.totalPages).toBe(2);
  expect(result6.page.isFirst).toBe(true);
  expect(result6.page.isLast).toBe(false);
  expect(result6.page.sort?.sorted).toBe(true);
  expect(result6.page.sort?.fields).toEqual([
    { field: "name", direction: "asc" },
  ]);

  // Test 7: Second page
  const result7 = await app.users.paginate(
    { sort: "name", size: 2, page: 1 },
    {},
    { count: true },
  );

  expect(result7.content.length).toBe(2);
  expect(result7.content[0].name).toBe("Charlie");
  expect(result7.content[1].name).toBe("David");
  expect(result7.page.isFirst).toBe(false);
  expect(result7.page.isLast).toBe(true);
  expect(result7.page.sort?.sorted).toBe(true);
  expect(result7.page.sort?.fields).toEqual([
    { field: "name", direction: "asc" },
  ]);

  // Test 8: Sort with spaces (should be trimmed)
  const result8 = await app.users.paginate({ sort: " role , -name " });

  expect(result8.content.length).toBe(4);
  expect(result8.content[0].role).toBe("admin");
  expect(result8.content[0].name).toBe("Charlie");

  // Clean up
  await app.users.clear({ force: true });
};

// ============================================================================
// testSaveWithDeletedFields
// ============================================================================

const dummyEntity = $entity({
  name: "dummies",
  schema: t.object({
    id: db.primaryKey(),
    name: t.optional(t.text()),
  }),
});

class SaveApp {
  dummies = $repository(dummyEntity);
}

export const testSaveWithDeletedFields = async (alepha: Alepha) => {
  const app = alepha.inject(SaveApp);
  await alepha.start();

  // Create a new entity
  const entity = await app.dummies.create({ name: "Test" });
  expect(await app.dummies.getById(entity.id).then((it) => it.name)).toBe(
    "Test",
  );

  // Update the entity to set name to undefined (delete the field)
  entity.name = undefined;
  await app.dummies.save(entity);
  expect(entity.name).toBeUndefined();
  expect(
    await app.dummies.getById(entity.id).then((it) => it.name),
  ).toBeUndefined();
};

// ============================================================================
// testTransactionThrowsWhenUnsupported
// ============================================================================

export const testTransactionThrowsWhenUnsupported = async (alepha: Alepha) => {
  class App {
    users = $repository(userEntity);
  }

  const app = alepha.inject(App);
  await alepha.start();

  // Temporarily override supportsTransactions
  const provider = (app.users as any).provider;
  const original = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(provider),
    "supportsTransactions",
  );
  Object.defineProperty(provider, "supportsTransactions", {
    get: () => false,
    configurable: true,
  });

  try {
    await expect(
      app.users.transaction(async () => {
        // should never reach here
      }),
    ).rejects.toThrow("Transactions are not supported");
  } finally {
    // Restore
    if (original) {
      Object.defineProperty(
        Object.getPrototypeOf(provider),
        "supportsTransactions",
        original,
      );
    } else {
      delete provider.supportsTransactions;
    }
  }
};

// ============================================================================
// testSaveWithCustomPrimaryKey
// ============================================================================

const customPkEntity = $entity({
  name: "custom_pk_items",
  schema: t.object({
    code: db.primaryKey(t.uuid()),
    label: t.text(),
  }),
});

class CustomPkApp {
  items = $repository(customPkEntity);
}

export const testSaveWithCustomPrimaryKey = async (alepha: Alepha) => {
  const app = alepha.inject(CustomPkApp);
  await alepha.start();

  const entity = await app.items.create({ label: "Original" });
  expect(entity.code).toBeDefined();
  expect(entity.label).toBe("Original");

  entity.label = "Updated";
  await app.items.save(entity);

  const updated = await app.items.getById(entity.code);
  expect(updated.label).toBe("Updated");
};

// ============================================================================
// testUpsert
// ============================================================================

const productEntity = $entity({
  name: "products",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    sku: t.text(),
    name: t.text(),
    price: t.number(),
  }),
  indexes: [{ column: "sku", unique: true }],
});

class UpsertApp {
  products = $repository(productEntity);
}

export const testUpsert = async (alepha: Alepha) => {
  const app = alepha.inject(UpsertApp);
  await alepha.start();

  // ========================================
  // INSERT (no conflict)
  // ========================================

  const created = await app.products.upsert({
    id: "00000000-0000-0000-0000-000000000001",
    sku: "WIDGET-1",
    name: "Widget",
    price: 9.99,
  });

  expect(created.id).toBe("00000000-0000-0000-0000-000000000001");
  expect(created.sku).toBe("WIDGET-1");
  expect(created.name).toBe("Widget");
  expect(created.price).toBe(9.99);

  // ========================================
  // UPDATE (conflict on primary key)
  // ========================================

  const upserted = await app.products.upsert({
    id: "00000000-0000-0000-0000-000000000001",
    sku: "WIDGET-1",
    name: "Widget Pro",
    price: 19.99,
  });

  expect(upserted.id).toBe("00000000-0000-0000-0000-000000000001");
  expect(upserted.name).toBe("Widget Pro");
  expect(upserted.price).toBe(19.99);

  // Verify only one record exists
  expect(await app.products.count()).toBe(1);

  // ========================================
  // UPSERT with custom target (unique column)
  // ========================================

  const gadget = await app.products.upsert({
    id: "00000000-0000-0000-0000-000000000002",
    sku: "GADGET-1",
    name: "Gadget",
    price: 29.99,
  });

  expect(gadget.name).toBe("Gadget");

  // Upsert on sku conflict — new id is ignored, existing row is updated
  const gadgetUpdated = await app.products.upsert(
    {
      id: "00000000-0000-0000-0000-000000000099",
      sku: "GADGET-1",
      name: "Gadget v2",
      price: 39.99,
    },
    { target: ["sku"] },
  );

  expect(gadgetUpdated.id).toBe("00000000-0000-0000-0000-000000000002");
  expect(gadgetUpdated.name).toBe("Gadget v2");
  expect(gadgetUpdated.price).toBe(39.99);

  // Still only 2 records
  expect(await app.products.count()).toBe(2);

  // ========================================
  // UPSERT with custom set (partial update)
  // ========================================

  // Only update the price on conflict, keep name unchanged
  const gadgetPartial = await app.products.upsert(
    {
      id: "00000000-0000-0000-0000-000000000002",
      sku: "GADGET-1",
      name: "Should Not Change",
      price: 49.99,
    },
    {
      target: ["sku"],
      set: { price: 49.99 },
    },
  );

  expect(gadgetPartial.id).toBe("00000000-0000-0000-0000-000000000002");
  expect(gadgetPartial.name).toBe("Gadget v2"); // unchanged
  expect(gadgetPartial.price).toBe(49.99); // updated

  // ========================================
  // UPSERT sets updatedAt
  // ========================================

  const beforeUpdate = gadget.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  const gadgetAgain = await app.products.upsert(
    {
      id: "00000000-0000-0000-0000-000000000002",
      sku: "GADGET-1",
      name: "Gadget v3",
      price: 59.99,
    },
    { target: ["sku"] },
  );

  expect(gadgetAgain.updatedAt).not.toBe(beforeUpdate);

  // ========================================
  // UPSERT inserts new record via custom target
  // ========================================

  const newProduct = await app.products.upsert(
    {
      id: "00000000-0000-0000-0000-000000000003",
      sku: "THING-1",
      name: "Thing",
      price: 5.0,
    },
    { target: ["sku"] },
  );

  expect(newProduct.name).toBe("Thing");
  expect(await app.products.count()).toBe(3);
};

// ============================================================================
// testSerialIdOperations
// ============================================================================

const serialTestSchema = t.object({
  id: db.primaryKey(),
  name: t.text(),
});

const serialTestEntity = $entity({
  name: "test",
  schema: serialTestSchema,
});

class SerialIdApp {
  repository = $repository(serialTestEntity);
}

export const testSerialIdOperations = async (alepha: Alepha) => {
  const app = alepha.inject(SerialIdApp);
  await alepha.start();

  expect(app.repository.id.key).toEqual("id");

  const it = await app.repository.create({ name: "test" });

  expect(await app.repository.getById(it.id)).toEqual(it);
  expect(await app.repository.getById(String(it.id))).toEqual(it);

  const update = await app.repository.updateById(it.id, { name: "2" });

  expect(await app.repository.getById(it.id)).toEqual(update);

  await app.repository.deleteById(it.id);

  expect(await app.repository.count()).toBe(0);
};

// ============================================================================
// testUuidIdOperations
// ============================================================================

const uuidSchema = t.object({
  uuid: db.uuidPrimaryKey(),
  name: t.text(),
});

const uuidEntity = $entity({
  name: "test",
  schema: uuidSchema,
});

class UuidIdApp {
  repository = $repository(uuidEntity);
}

export const testUuidIdOperations = async (alepha: Alepha) => {
  const app = alepha.inject(UuidIdApp);
  await alepha.start();

  expect(app.repository.id.key).toEqual("uuid");
  expect(app.repository.id.type).toEqual(db.uuidPrimaryKey());

  const it = await app.repository.create({ name: "test" });

  expect(await app.repository.getById(it.uuid)).toEqual(it);

  const update = await app.repository.updateById(it.uuid, { name: "2" });

  expect(await app.repository.getById(it.uuid)).toEqual(update);

  await app.repository.deleteById(it.uuid);

  expect(await app.repository.count()).toBe(0);
};

// ============================================================================
// testMultipleOperators
// ============================================================================

const rangeSchema = t.object({
  id: db.primaryKey(),
  name: t.text(),
  age: t.number(),
});

const rangeEntity = $entity({
  name: "test_range",
  schema: rangeSchema,
});

class MultipleOperatorsApp {
  repository = $repository(rangeEntity);
}

export const testMultipleOperators = async (alepha: Alepha) => {
  const app = alepha.inject(MultipleOperatorsApp);
  await alepha.start();

  // Create test data
  await app.repository.create({ name: "Alice", age: 20 });
  await app.repository.create({ name: "Bob", age: 25 });
  await app.repository.create({ name: "Charlie", age: 30 });
  await app.repository.create({ name: "David", age: 35 });
  await app.repository.create({ name: "Eve", age: 40 });

  // Test range query with both gte and lte
  const results = await app.repository.findMany({
    where: {
      age: { gte: 25, lte: 35 },
    },
  });

  expect(results).toHaveLength(3);
  expect(results.map((r) => r.name).sort()).toEqual([
    "Bob",
    "Charlie",
    "David",
  ]);

  // Test with only gte
  const resultsGte = await app.repository.findMany({
    where: {
      age: { gte: 35 },
    },
  });

  expect(resultsGte).toHaveLength(2);
  expect(resultsGte.map((r) => r.name).sort()).toEqual(["David", "Eve"]);

  // Test with only lte
  const resultsLte = await app.repository.findMany({
    where: {
      age: { lte: 25 },
    },
  });

  expect(resultsLte).toHaveLength(2);
  expect(resultsLte.map((r) => r.name).sort()).toEqual(["Alice", "Bob"]);
};

// ============================================================================
// testCrudWithTimestamps
// ============================================================================

class TimestampsApp {
  users = $repository(userEntity);
}

export const testCrudWithTimestamps = async (alepha: Alepha) => {
  const app = alepha.inject(TimestampsApp);
  const dt = alepha.inject(DateTimeProvider);
  await alepha.start();

  dt.pause();

  await app.users.create({
    name: "John",
    profile: {
      age: 30,
    },
  });

  const [r1] = await app.users.findMany({
    where: { name: { eq: "John" } },
  });

  expect(r1.name).toEqual("John");
  expect(r1.createdAt).toBe(r1.updatedAt);

  dt.travel(1000);

  const r2 = await app.users.updateOne(
    { name: { eq: "John" } },
    {
      profile: { age: 31 },
    },
  );

  expect(r2.name).toEqual("John");
  expect(r2.profile.age).toEqual(31);
  expect(r2.createdAt).toBe(r1.createdAt);
  expect(r2.updatedAt).not.toBe(r1.updatedAt);
};

// ============================================================================
// testPagination
// ============================================================================

class PaginationApp {
  users = $repository(userEntity);
}

export const testPagination = async (alepha: Alepha) => {
  const app = alepha.inject(PaginationApp);
  await alepha.start();

  // Create test data - 25 users
  const users: InsertUserEntity[] = [];
  for (let i = 1; i <= 25; i++) {
    users.push({
      name: `User ${i}`,
      profile: { age: 20 + i },
      role: i % 2 === 0 ? "admin" : "user",
    });
  }

  for (const user of users) {
    await app.users.create(user);
  }

  // Test 1: First page without count
  const page1 = await app.users.paginate({ page: 0, size: 10 });

  expect(page1.content.length).toBe(10);
  expect(page1.page.number).toBe(0);
  expect(page1.page.size).toBe(10);
  expect(page1.page.offset).toBe(0);
  expect(page1.page.numberOfElements).toBe(10);
  expect(page1.page.isEmpty).toBe(false);
  expect(page1.page.isFirst).toBe(true);
  expect(page1.page.isLast).toBe(false);
  expect(page1.page.totalElements).toBeUndefined();
  expect(page1.page.totalPages).toBeUndefined();

  // Test 2: First page with count
  const page2 = await app.users.paginate(
    { page: 0, size: 10 },
    {},
    { count: true },
  );

  expect(page2.content.length).toBe(10);
  expect(page2.page.number).toBe(0);
  expect(page2.page.size).toBe(10);
  expect(page2.page.offset).toBe(0);
  expect(page2.page.numberOfElements).toBe(10);
  expect(page2.page.isEmpty).toBe(false);
  expect(page2.page.isFirst).toBe(true);
  expect(page2.page.isLast).toBe(false);
  expect(page2.page.totalElements).toBe(25);
  expect(page2.page.totalPages).toBe(3);

  // Test 3: Middle page with count
  const page3 = await app.users.paginate(
    { page: 1, size: 10 },
    {},
    { count: true },
  );

  expect(page3.content.length).toBe(10);
  expect(page3.page.number).toBe(1);
  expect(page3.page.size).toBe(10);
  expect(page3.page.offset).toBe(10);
  expect(page3.page.numberOfElements).toBe(10);
  expect(page3.page.isEmpty).toBe(false);
  expect(page3.page.isFirst).toBe(false);
  expect(page3.page.isLast).toBe(false);
  expect(page3.page.totalElements).toBe(25);
  expect(page3.page.totalPages).toBe(3);

  // Test 4: Last page with count
  const page4 = await app.users.paginate(
    { page: 2, size: 10 },
    {},
    { count: true },
  );

  expect(page4.content.length).toBe(5);
  expect(page4.page.number).toBe(2);
  expect(page4.page.size).toBe(10);
  expect(page4.page.offset).toBe(20);
  expect(page4.page.numberOfElements).toBe(5);
  expect(page4.page.isEmpty).toBe(false);
  expect(page4.page.isFirst).toBe(false);
  expect(page4.page.isLast).toBe(true);
  expect(page4.page.totalElements).toBe(25);
  expect(page4.page.totalPages).toBe(3);

  // Test 5: Empty page (beyond last page)
  const page5 = await app.users.paginate(
    { page: 3, size: 10 },
    {},
    { count: true },
  );

  expect(page5.content.length).toBe(0);
  expect(page5.page.number).toBe(3);
  expect(page5.page.size).toBe(10);
  expect(page5.page.offset).toBe(30);
  expect(page5.page.numberOfElements).toBe(0);
  expect(page5.page.isEmpty).toBe(true);
  expect(page5.page.isFirst).toBe(false);
  expect(page5.page.isLast).toBe(true);
  expect(page5.page.totalElements).toBe(25);
  expect(page5.page.totalPages).toBe(3);

  // Test 6: Custom page size
  const page6 = await app.users.paginate(
    { page: 0, size: 7 },
    {},
    { count: true },
  );

  expect(page6.content.length).toBe(7);
  expect(page6.page.number).toBe(0);
  expect(page6.page.size).toBe(7);
  expect(page6.page.offset).toBe(0);
  expect(page6.page.numberOfElements).toBe(7);
  expect(page6.page.isEmpty).toBe(false);
  expect(page6.page.isFirst).toBe(true);
  expect(page6.page.isLast).toBe(false);
  expect(page6.page.totalElements).toBe(25);
  expect(page6.page.totalPages).toBe(4); // Math.ceil(25 / 7) = 4

  // Test 7: Page size equals total items
  const page7 = await app.users.paginate(
    { page: 0, size: 25 },
    {},
    { count: true },
  );

  expect(page7.content.length).toBe(25);
  expect(page7.page.number).toBe(0);
  expect(page7.page.size).toBe(25);
  expect(page7.page.offset).toBe(0);
  expect(page7.page.numberOfElements).toBe(25);
  expect(page7.page.isEmpty).toBe(false);
  expect(page7.page.isFirst).toBe(true);
  expect(page7.page.isLast).toBe(true);
  expect(page7.page.totalElements).toBe(25);
  expect(page7.page.totalPages).toBe(1);

  // Test 8: Page size greater than total items
  const page8 = await app.users.paginate(
    { page: 0, size: 50 },
    {},
    { count: true },
  );

  expect(page8.content.length).toBe(25);
  expect(page8.page.number).toBe(0);
  expect(page8.page.size).toBe(50);
  expect(page8.page.offset).toBe(0);
  expect(page8.page.numberOfElements).toBe(25);
  expect(page8.page.isEmpty).toBe(false);
  expect(page8.page.isFirst).toBe(true);
  expect(page8.page.isLast).toBe(true);
  expect(page8.page.totalElements).toBe(25);
  expect(page8.page.totalPages).toBe(1); // Math.ceil(25 / 50) = 1

  // Test 9: Empty table
  await app.users.clear({ force: true });
  const page9 = await app.users.paginate(
    { page: 0, size: 10 },
    {},
    { count: true },
  );

  expect(page9.content.length).toBe(0);
  expect(page9.page.number).toBe(0);
  expect(page9.page.size).toBe(10);
  expect(page9.page.offset).toBe(0);
  expect(page9.page.numberOfElements).toBe(0);
  expect(page9.page.isEmpty).toBe(true);
  expect(page9.page.isFirst).toBe(true);
  expect(page9.page.isLast).toBe(true);
  expect(page9.page.totalElements).toBe(0);
  expect(page9.page.totalPages).toBe(0); // Math.ceil(0 / 10) = 0

  // Test 10: Single item
  await app.users.create({
    name: "Single User",
    profile: { age: 25 },
    role: "user",
  });

  const page10 = await app.users.paginate(
    { page: 0, size: 10 },
    {},
    { count: true },
  );

  expect(page10.content.length).toBe(1);
  expect(page10.page.number).toBe(0);
  expect(page10.page.size).toBe(10);
  expect(page10.page.offset).toBe(0);
  expect(page10.page.numberOfElements).toBe(1);
  expect(page10.page.isEmpty).toBe(false);
  expect(page10.page.isFirst).toBe(true);
  expect(page10.page.isLast).toBe(true);
  expect(page10.page.totalElements).toBe(1);
  expect(page10.page.totalPages).toBe(1); // Math.ceil(1 / 10) = 1

  // Test 11: Pagination with where clause
  await app.users.clear({ force: true });
  for (let i = 1; i <= 20; i++) {
    await app.users.create({
      name: `User ${i}`,
      profile: { age: 20 + i },
      role: i % 2 === 0 ? "admin" : "user",
    });
  }

  const page11 = await app.users.paginate(
    { page: 0, size: 5 },
    { where: { role: "admin" } },
    { count: true },
  );

  expect(page11.content.length).toBe(5);
  expect(page11.page.number).toBe(0);
  expect(page11.page.size).toBe(5);
  expect(page11.page.offset).toBe(0);
  expect(page11.page.numberOfElements).toBe(5);
  expect(page11.page.isEmpty).toBe(false);
  expect(page11.page.isFirst).toBe(true);
  expect(page11.page.isLast).toBe(false);
  expect(page11.page.totalElements).toBe(10); // Only admin users
  expect(page11.page.totalPages).toBe(2); // Math.ceil(10 / 5) = 2

  // Test 12: Last page of filtered results
  const page12 = await app.users.paginate(
    { page: 1, size: 5 },
    { where: { role: "admin" } },
    { count: true },
  );

  expect(page12.content.length).toBe(5);
  expect(page12.page.number).toBe(1);
  expect(page12.page.size).toBe(5);
  expect(page12.page.offset).toBe(5);
  expect(page12.page.numberOfElements).toBe(5);
  expect(page12.page.isEmpty).toBe(false);
  expect(page12.page.isFirst).toBe(false);
  expect(page12.page.isLast).toBe(true);
  expect(page12.page.totalElements).toBe(10);
  expect(page12.page.totalPages).toBe(2);

  // Test 13: Default pagination (no params)
  const page13 = await app.users.paginate();

  expect(page13.content.length).toBe(10); // Default size is 10
  expect(page13.page.number).toBe(0);
  expect(page13.page.size).toBe(10);
  expect(page13.page.offset).toBe(0);
  expect(page13.page.numberOfElements).toBe(10);
  expect(page13.page.isEmpty).toBe(false);
  expect(page13.page.isFirst).toBe(true);
  expect(page13.page.isLast).toBe(false);

  // Clean up
  await app.users.clear({ force: true });
};
