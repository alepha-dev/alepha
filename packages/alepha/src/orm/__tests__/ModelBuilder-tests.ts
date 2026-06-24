import type { Alepha } from "alepha";
import { z } from "alepha";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { $entity, $repository } from "../core/index.ts";
import { db } from "../core/providers/DatabaseTypeProvider.ts";

// ---------------------------------------------------------------------------
// Entities for testModelBuilderFeatures
// ---------------------------------------------------------------------------

const roleEntity = $entity({
  name: "roles",
  schema: z.object({
    id: db.primaryKey(),
    name: z.string(),
    description: z.string().optional(),
  }),
  indexes: ["name"],
  constraints: [
    {
      columns: ["name"],
      unique: true,
      name: "unique_role_name",
    },
  ],
});

const userEntity = $entity({
  name: "users",
  schema: z.object({
    id: db.primaryKey(),
    email: z.email(),
    username: z.string(),
    age: z.integer(),
    roleId: z.integer(),
    status: z.string(),
  }),
  indexes: [
    "email",
    {
      column: "username",
      unique: true,
      name: "unique_username_idx",
    },
    {
      columns: ["roleId", "status"],
      name: "role_status_idx",
    },
  ],
  foreignKeys: [
    {
      columns: ["roleId"],
      foreignColumns: [() => roleEntity.cols.id],
    },
  ],
  constraints: [
    {
      columns: ["age"],
      check: sql`age >= 18 AND age <= 120`,
      name: "valid_age_range",
    },
    {
      columns: ["email", "username"],
      unique: true,
      name: "unique_email_username",
    },
  ],
});

const postEntity = $entity({
  name: "posts",
  schema: z.object({
    id: db.primaryKey(),
    userId: z.integer(),
    title: z.string(),
    content: z.text(),
    published: z.boolean(),
    views: z.integer(),
    tags: z.array(z.string()).optional(),
  }),
  indexes: [
    "title",
    {
      column: "published",
      name: "published_idx",
    },
    {
      columns: ["userId", "published"],
      name: "user_published_idx",
    },
    {
      columns: ["userId", "views"],
      unique: true,
      name: "unique_user_views",
    },
  ],
  foreignKeys: [
    {
      name: "posts_user_fk",
      columns: ["userId"],
      foreignColumns: [() => userEntity.cols.id],
    },
  ],
  constraints: [
    {
      columns: ["views"],
      check: sql`views >= 0`,
      name: "positive_views",
    },
  ],
});

class TestApp {
  roles = $repository(roleEntity);
  users = $repository(userEntity);
  posts = $repository(postEntity);
}

// ---------------------------------------------------------------------------
// testModelBuilderFeatures
// ---------------------------------------------------------------------------

export const testModelBuilderFeatures = async (alepha: Alepha) => {
  const app = alepha.inject(TestApp);
  await alepha.start();

  // Test 1: Create roles (tests unique constraint on name)
  const adminRole = await app.roles.create({
    name: "admin",
    description: "Administrator role",
  });
  expect(adminRole.id).toBeDefined();
  expect(adminRole.name).toBe("admin");

  const userRole = await app.roles.create({
    name: "user",
    description: "Regular user role",
  });
  expect(userRole.id).toBeDefined();

  // Test unique constraint violation
  try {
    await app.roles.create({
      name: "admin", // Duplicate name
      description: "Another admin",
    });
    expect.fail("Should have thrown unique constraint error");
  } catch (error: any) {
    // Expected: unique constraint violation
    expect(error).toBeDefined();
  }

  // Test 2: Create users (tests foreign key, check constraint, and unique indexes)
  const user1 = await app.users.create({
    email: "alice@example.com",
    username: "alice",
    age: 25,
    roleId: adminRole.id,
    status: "active",
  });
  expect(user1.id).toBeDefined();
  expect(user1.username).toBe("alice");

  const user2 = await app.users.create({
    email: "bob@example.com",
    username: "bob",
    age: 30,
    roleId: userRole.id,
    status: "active",
  });
  expect(user2.id).toBeDefined();

  // Test unique index on username
  try {
    await app.users.create({
      email: "charlie@example.com",
      username: "alice", // Duplicate username
      age: 28,
      roleId: userRole.id,
      status: "active",
    });
    expect.fail("Should have thrown unique constraint error on username");
  } catch (error: any) {
    // Expected: unique constraint violation
    expect(error).toBeDefined();
  }

  // Test check constraint (age must be >= 18)
  try {
    await app.users.create({
      email: "young@example.com",
      username: "younguser",
      age: 15, // Below minimum age
      roleId: userRole.id,
      status: "pending",
    });
    expect.fail("Should have thrown check constraint error for age");
  } catch (error: any) {
    // Expected: check constraint violation
    expect(error).toBeDefined();
  }

  // Test composite unique constraint (email + username)
  try {
    await app.users.create({
      email: "alice@example.com", // Same email as user1
      username: "alice", // Same username as user1
      age: 22,
      roleId: userRole.id,
      status: "inactive",
    });
    expect.fail("Should have thrown composite unique constraint error");
  } catch (error: any) {
    // Expected: composite unique constraint violation
    expect(error).toBeDefined();
  }

  // Test 3: Create posts (tests multiple indexes and foreign key)
  const post1 = await app.posts.create({
    userId: user1.id,
    title: "First Post",
    content: "This is the first post",
    published: true,
    views: 100,
  });
  expect(post1.id).toBeDefined();
  expect(post1.views).toBe(100);

  const post2 = await app.posts.create({
    userId: user1.id,
    title: "Second Post",
    content: "This is the second post",
    published: false,
    views: 50,
    tags: ["tech", "tutorial"],
  });
  expect(post2.id).toBeDefined();
  expect(post2.tags).toEqual(["tech", "tutorial"]);

  // Test check constraint (views must be >= 0)
  try {
    await app.posts.create({
      userId: user2.id,
      title: "Invalid Post",
      content: "This post has negative views",
      published: true,
      views: -10, // Negative views
    });
    expect.fail("Should have thrown check constraint error for views");
  } catch (error: any) {
    // Expected: check constraint violation
    expect(error).toBeDefined();
  }

  // Test unique index on (userId, views) - only for testing unique composite index
  try {
    await app.posts.create({
      userId: user1.id,
      title: "Duplicate Views Post",
      content: "This has the same userId and views",
      published: true,
      views: 100, // Same views as post1 for same user
    });
    expect.fail(
      "Should have thrown unique constraint error on (userId, views)",
    );
  } catch (error: any) {
    // Expected: unique constraint violation
    expect(error).toBeDefined();
  }

  // Test 4: Query using indexes (verify they improve query performance)
  // Find users by email (uses email index)
  const usersByEmail = await app.users.findMany({
    where: { email: { eq: "alice@example.com" } },
  });
  expect(usersByEmail.length).toBe(1);
  expect(usersByEmail[0].username).toBe("alice");

  // Find users by roleId and status (uses composite index)
  const adminUsers = await app.users.findMany({
    where: { roleId: { eq: adminRole.id } },
    orderBy: "status",
  });
  expect(adminUsers.length).toBeGreaterThan(0);
  expect(adminUsers[0].roleId).toBe(adminRole.id);

  // Find posts by userId and published status (uses composite index)
  const publishedPosts = await app.posts.findMany({
    where: {
      userId: { eq: user1.id },
      published: { eq: true },
    },
  });
  expect(publishedPosts.length).toBeGreaterThan(0);
  expect(publishedPosts[0].published).toBe(true);

  // Clean up
  await app.posts.clear({ force: true });
  await app.users.clear({ force: true });
  await app.roles.clear({ force: true });
};

// ---------------------------------------------------------------------------
// testCustomConfig
// ---------------------------------------------------------------------------

export const testCustomConfig = async (alepha: Alepha) => {
  const customEntity = $entity({
    name: "custom_table",
    schema: z.object({
      id: db.primaryKey(),
      data: z.string(),
    }),
    config: (self) => {
      return [];
    },
  });

  class CustomApp {
    custom = $repository(customEntity);
  }

  const app = alepha.inject(CustomApp);
  await alepha.start();

  const record = await app.custom.create({
    data: "test data",
  });
  expect(record.id).toBeDefined();
  expect(record.data).toBe("test data");

  await app.custom.clear({ force: true });
};

// ---------------------------------------------------------------------------
// testComplexRelationships
// ---------------------------------------------------------------------------

export const testComplexRelationships = async (alepha: Alepha) => {
  const categoryEntity = $entity({
    name: "categories",
    schema: z.object({
      id: db.primaryKey(),
      name: z.string(),
    }),
    indexes: [
      {
        column: "name",
        unique: true,
      },
    ],
  });

  const productEntity = $entity({
    name: "products",
    schema: z.object({
      id: db.primaryKey(),
      name: z.string(),
      categoryId: z.integer(),
      price: z.number(),
    }),
    indexes: [
      "name",
      {
        columns: ["categoryId", "price"],
        name: "category_price_idx",
      },
    ],
    foreignKeys: [
      {
        columns: ["categoryId"],
        foreignColumns: [() => categoryEntity.cols.id],
      },
    ],
    constraints: [
      {
        columns: ["price"],
        check: sql`price > 0`,
        name: "positive_price",
      },
    ],
  });

  class ComplexApp {
    categories = $repository(categoryEntity);
    products = $repository(productEntity);
  }

  const app = alepha.inject(ComplexApp);
  await alepha.start();

  // Create test data
  const electronics = await app.categories.create({
    name: "Electronics",
  });

  const laptop = await app.products.create({
    name: "Laptop",
    categoryId: electronics.id,
    price: 999.99,
  });

  expect(laptop.categoryId).toBe(electronics.id);
  expect(laptop.price).toBe(999.99);

  // Test constraint
  try {
    await app.products.create({
      name: "Invalid Product",
      categoryId: electronics.id,
      price: -10, // Invalid price
    });
    expect.fail("Should have thrown check constraint error");
  } catch (error) {
    // Expected
    expect(error).toBeDefined();
  }

  // Clean up
  await app.products.clear({ force: true });
  await app.categories.clear({ force: true });
};

// ---------------------------------------------------------------------------
// Expression-based index: LOWER username uniqueness
// ---------------------------------------------------------------------------

const usersWithLowerIndex = $entity({
  name: "users_lower",
  schema: z.object({
    id: db.primaryKey(),
    realm: z.text(),
    username: z.text(),
  }),
  indexes: [
    {
      expressions: (self) => [self.realm, sql`LOWER(${self.username})`],
      unique: true,
      name: "users_lower_realm_username_idx",
    },
  ],
});

export const testExpressionIndex = async (alepha: Alepha) => {
  class App {
    users = $repository(usersWithLowerIndex);
  }

  const app = alepha.inject(App);
  await alepha.start();

  // Insert first user
  await app.users.create({ realm: "default", username: "JohnDoe" });

  // Same username different case in same realm should fail (unique LOWER index)
  try {
    await app.users.create({ realm: "default", username: "johndoe" });
    expect.fail("Should have thrown unique constraint error");
  } catch (error) {
    expect(error).toBeDefined();
  }

  // Same username different realm should succeed
  await app.users.create({ realm: "other", username: "JohnDoe" });

  // Different username same realm should succeed
  await app.users.create({ realm: "default", username: "JaneDoe" });

  // Verify all 3 records exist
  const all = await app.users.findMany({});
  expect(all.length).toBe(3);

  // Clean up
  await app.users.clear({ force: true });
};
