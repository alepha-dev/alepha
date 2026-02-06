import { Alepha, t } from "alepha";
import { describe, expect, it } from "vitest";
import { DbEntityNotFoundError } from "../errors/DbEntityNotFoundError.ts";
import { $entity, $repository, pg } from "../index.ts";
import type { InsertUserEntity } from "./fixtures/userEntitySchema.ts";

class App {
  users = $repository(
    $entity({
      name: "users",
      schema: t.object({
        id: pg.primaryKey(),
        createdAt: pg.createdAt(),
        updatedAt: pg.updatedAt(),
        name: t.text(),
        profile: t.object({
          age: t.number(),
        }),
        role: pg.default(t.text(), "user"),
      }),
    }),
  );
}

const testBasicCrud = async (alepha: Alepha) => {
  const app = alepha.inject(App);
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

describe("$repository - CRUD operations", () => {
  it("should support basic CRUD operations (postgres)", async () => {
    await testBasicCrud(Alepha.create());
  });

  it("should support basic CRUD operations (pglite)", async () => {
    process.env.DATABASE_URL = "pglite://:memory:";
    await testBasicCrud(Alepha.create());
  });

  it("should support basic CRUD operations (sqlite)", async () => {
    process.env.DATABASE_URL = "sqlite://:memory:";
    await testBasicCrud(Alepha.create());
  });
});
