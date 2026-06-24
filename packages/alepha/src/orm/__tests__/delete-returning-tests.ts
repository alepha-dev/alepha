import { type Alepha, z } from "alepha";
import { expect } from "vitest";
import { DbEntityNotFoundError } from "../core/errors/DbEntityNotFoundError.ts";
import { $entity, $repository } from "../core/index.ts";
import { db } from "../core/providers/DatabaseTypeProvider.ts";

const userEntity = $entity({
  name: "users",
  schema: z.object({
    id: db.primaryKey(),
    name: z.string(),
    email: z.email(),
    active: z.boolean(),
  }),
});

const postEntity = $entity({
  name: "posts",
  schema: z.object({
    id: db.primaryKey(),
    userId: z.integer(),
    title: z.string(),
    content: z.text(),
  }),
});

class TestApp {
  users = $repository(userEntity);
  posts = $repository(postEntity);
}

export const testDeleteReturning = async (alepha: Alepha) => {
  const app = alepha.inject(TestApp);
  await alepha.start();

  // Test 1: deleteById returns the deleted ID
  const user1 = await app.users.create({
    name: "Alice",
    email: "alice@example.com",
    active: true,
  });

  const deletedIds = await app.users.deleteById(user1.id);
  expect(deletedIds).toHaveLength(1);
  expect(deletedIds[0]).toBe(user1.id);

  // Verify the user is deleted
  await expect(app.users.getById(user1.id)).rejects.toThrow(
    DbEntityNotFoundError,
  );

  // Test 2: deleteById throws error when entity not found
  await expect(app.users.deleteById(999999)).rejects.toThrow(
    DbEntityNotFoundError,
  );

  // Test 3: deleteMany returns array of deleted IDs
  const users = await Promise.all([
    app.users.create({ name: "Bob", email: "bob@example.com", active: true }),
    app.users.create({
      name: "Charlie",
      email: "charlie@example.com",
      active: false,
    }),
    app.users.create({
      name: "David",
      email: "david@example.com",
      active: true,
    }),
  ]);

  const activeUserIds = users
    .filter((u) => u.active)
    .map((u) => u.id)
    .sort((a, b) => a - b);

  const deletedActiveIds = await app.users.deleteMany({
    active: { eq: true },
  });

  expect(deletedActiveIds).toHaveLength(2);
  expect(deletedActiveIds.sort((a, b) => Number(a) - Number(b))).toEqual(
    activeUserIds,
  );

  // Verify only inactive user remains
  const remaining = await app.users.findMany({});
  expect(remaining).toHaveLength(1);
  expect(remaining[0].name).toBe("Charlie");

  // Test 4: deleteOne returns array with single ID
  const deletedOneIds = await app.users.deleteOne({
    email: { eq: "charlie@example.com" },
  });
  expect(deletedOneIds).toHaveLength(1);
  expect(deletedOneIds[0]).toBe(users[1].id);

  // Test 5: clear returns all deleted IDs
  const moreUsers = await Promise.all([
    app.users.create({ name: "Eve", email: "eve@example.com", active: true }),
    app.users.create({
      name: "Frank",
      email: "frank@example.com",
      active: false,
    }),
    app.users.create({
      name: "Grace",
      email: "grace@example.com",
      active: true,
    }),
  ]);

  const allIds = moreUsers.map((u) => u.id).sort((a, b) => a - b);
  const clearedIds = await app.users.clear();

  expect(clearedIds).toHaveLength(3);
  expect(clearedIds.sort((a, b) => Number(a) - Number(b))).toEqual(allIds);

  // Verify table is empty
  expect(await app.users.count()).toBe(0);

  // Test 6: destroy returns the deleted ID
  const user = await app.users.create({
    name: "Helen",
    email: "helen@example.com",
    active: true,
  });

  const destroyedIds = await app.users.destroy(user);
  expect(destroyedIds).toHaveLength(1);
  expect(destroyedIds[0]).toBe(user.id);

  // Test 7: deleteMany with no matches returns empty array
  const emptyResult = await app.users.deleteMany({
    name: { eq: "NonExistent" },
  });
  expect(emptyResult).toHaveLength(0);

  // Test 8: Test with composite operations
  const posts = await Promise.all([
    app.posts.create({
      userId: 1,
      title: "Post 1",
      content: "Content 1",
    }),
    app.posts.create({
      userId: 1,
      title: "Post 2",
      content: "Content 2",
    }),
    app.posts.create({
      userId: 2,
      title: "Post 3",
      content: "Content 3",
    }),
  ]);

  const deletedPostIds = await app.posts.deleteMany({
    userId: { eq: 1 },
  });

  expect(deletedPostIds).toHaveLength(2);
  const sortedDeletedIds = deletedPostIds.sort((a, b) => Number(a) - Number(b));
  const expectedIds = [posts[0].id, posts[1].id].sort((a, b) => a - b);
  expect(sortedDeletedIds).toEqual(expectedIds);

  // Clean up
  await app.posts.clear({ force: true });
  await app.users.clear({ force: true });
};

const softEntity = $entity({
  name: "soft_delete_items",
  schema: z.object({
    id: db.primaryKey(),
    name: z.string(),
    deletedAt: db.deletedAt(),
  }),
});

class SoftDeleteApp {
  items = $repository(softEntity);
}

export const testSoftDeleteReturning = async (alepha: Alepha) => {
  const app = alepha.inject(SoftDeleteApp);
  await alepha.start();

  // Create test items
  const item1 = await app.items.create({ name: "Item 1" });
  const item2 = await app.items.create({ name: "Item 2" });
  const item3 = await app.items.create({ name: "Item 3" });

  // Test soft delete by ID - this should trigger soft delete
  const softDeletedId = await app.items.deleteById(item1.id);
  expect(softDeletedId).toHaveLength(1);
  expect(softDeletedId[0]).toBe(item1.id);

  // Item should still exist but be soft deleted
  const allAfterSoftDelete = await app.items.findMany({}, { force: true });
  expect(allAfterSoftDelete).toHaveLength(3);

  const activeAfterSoftDelete = await app.items.findMany({});
  expect(activeAfterSoftDelete).toHaveLength(2);
  expect(activeAfterSoftDelete.map((i) => i.name).sort()).toEqual([
    "Item 2",
    "Item 3",
  ]);

  // Test soft delete multiple items
  const softDeletedIds = await app.items.deleteMany({
    name: { inArray: ["Item 2", "Item 3"] },
  });

  expect(softDeletedIds).toHaveLength(2);
  const sortedIds = softDeletedIds.sort((a, b) => Number(a) - Number(b));
  const expectedIds = [item2.id, item3.id].sort((a, b) => a - b);
  expect(sortedIds).toEqual(expectedIds);

  // All items should be soft deleted now
  const allItems = await app.items.findMany({}, { force: true });
  expect(allItems).toHaveLength(3);

  const activeItems = await app.items.findMany({});
  expect(activeItems).toHaveLength(0);

  // Force delete returns IDs
  const forceDeletedIds = await app.items.clear({ force: true });
  expect(forceDeletedIds).toHaveLength(3);

  // Table should be empty now
  const finalItems = await app.items.findMany({}, { force: true });
  expect(finalItems).toHaveLength(0);
};
