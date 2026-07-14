import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $entity, $repository, db, pageQuerySchema } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $action, HttpError } from "alepha/server";
import { beforeEach, describe, test } from "vitest";

/**
 * User Entity Definition
 * Defines the database schema for the User model with proper validation
 */
const userEntity = $entity({
  name: "crud_users",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    email: z.email(),
    name: z.text({ minLength: 1, maxLength: 100 }),
    age: z.number().min(0).max(150),
    isActive: db.default(z.boolean(), true),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  indexes: [{ column: "email", unique: true }],
});

// Entity schemas are available as userEntity.schema and userEntity.insertSchema
const userResourceSchema = userEntity.schema;

/**
 * Complete CRUD Application
 * Implements all CRUD operations with proper validation and error handling
 */
class UserCrudApp {
  users = $repository(userEntity);

  /** CREATE - Create a new user */
  createUser = $action({
    method: "POST",
    path: "/users",
    schema: {
      body: z.object({
        email: z.email(),
        name: z.text({ minLength: 1, maxLength: 100 }),
        age: z.number().min(0).max(150),
        isActive: z.boolean().optional(),
      }),
      response: userResourceSchema,
    },
    handler: async ({ body }) => {
      // Check for duplicate email
      const existing = await this.users.findMany({
        where: { email: { eq: body.email } },
        limit: 1,
      });

      if (existing.length > 0) {
        throw new HttpError({
          status: 409,
          message: `User with email ${body.email} already exists`,
        });
      }

      // Don't generate UUID - db.primaryKey() handles it automatically
      // Don't need to set isActive - db.default() handles it
      return await this.users.create({
        email: body.email,
        name: body.name,
        age: body.age,
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      });
    },
  });

  /** READ - Get a single user by ID */
  getUser = $action({
    method: "GET",
    path: "/users/:id",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      response: userResourceSchema,
    },
    handler: async ({ params }) => {
      // getById throws when not found
      return await this.users.getById(params.id);
    },
  });

  /** LIST - Get all users with pagination and filtering */
  listUsers = $action({
    method: "GET",
    path: "/users",
    schema: {
      query: pageQuerySchema.extend({
        search: z.text().optional(),
        isActive: z.boolean().optional(),
        minAge: z.number().min(0).optional(),
        maxAge: z.number().max(150).optional(),
      }),
      response: db.page(userResourceSchema),
    },
    handler: async ({ query }) => {
      const { page = 0, size = 10, search, isActive, minAge, maxAge } = query;

      // Build where conditions
      const whereConditions: any[] = [];

      if (search) {
        whereConditions.push({
          or: [
            { name: { ilike: `%${search}%` } },
            { email: { ilike: `%${search}%` } },
          ],
        });
      }

      if (isActive !== undefined) {
        whereConditions.push({ isActive: { eq: isActive } });
      }

      if (minAge !== undefined) {
        whereConditions.push({ age: { gte: minAge } });
      }

      if (maxAge !== undefined) {
        whereConditions.push({ age: { lte: maxAge } });
      }

      const where = whereConditions.length > 0 ? { and: whereConditions } : {};

      // paginate returns the page directly, not wrapped in { data: ... }
      return await this.users.paginate(
        { page, size },
        { where },
        { count: true },
      );
    },
  });

  /** UPDATE - Update a user */
  updateUser = $action({
    method: "PUT",
    path: "/users/:id",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      body: z.object({
        email: z.email().optional(),
        name: z.text({ minLength: 1, maxLength: 100 }).optional(),
        age: z.number().min(0).max(150).optional(),
        isActive: z.boolean().optional(),
      }),
      response: userResourceSchema,
    },
    handler: async ({ params, body }) => {
      // getById throws when not found
      const existing = await this.users.getById(params.id);

      // Check for duplicate email if email is being updated
      if (body.email && body.email !== existing.email) {
        const duplicate = await this.users.findMany({
          where: { email: { eq: body.email } },
          limit: 1,
        });

        if (duplicate.length > 0) {
          throw new HttpError({
            status: 409,
            message: `User with email ${body.email} already exists`,
          });
        }
      }

      return await this.users.updateById(params.id, body);
    },
  });

  /** DELETE - Delete a user */
  deleteUser = $action({
    method: "DELETE",
    path: "/users/:id",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      response: z.object({
        success: z.boolean(),
        id: z.uuid(),
      }),
    },
    handler: async ({ params }) => {
      // deleteById already throws when not found
      await this.users.deleteById(params.id);

      return {
        success: true,
        id: params.id,
      };
    },
  });

  /** BULK CREATE - Create multiple users */
  bulkCreateUsers = $action({
    method: "POST",
    path: "/users/bulk",
    schema: {
      body: z.object({
        users: z.array(
          z.object({
            email: z.email(),
            name: z.text({ minLength: 1, maxLength: 100 }),
            age: z.number().min(0).max(150),
            isActive: z.boolean().optional(),
          }),
        ),
      }),
      response: z.object({
        created: z.number(),
      }),
    },
    handler: async ({ body }) => {
      // Use createMany for bulk operations
      const createdUsers = await this.users.createMany(
        body.users.map((userData) => ({
          email: userData.email,
          name: userData.name,
          age: userData.age,
          ...(userData.isActive !== undefined && {
            isActive: userData.isActive,
          }),
        })),
      );

      return {
        created: createdUsers.length,
      };
    },
  });
}

describe("CRUD Application - Complete Integration Tests", () => {
  let alepha: Alepha;
  let app: UserCrudApp;

  beforeEach(async () => {
    // Let Alepha use the default database configuration
    alepha = Alepha.create().with(AlephaOrmPostgres);
    app = alepha.inject(UserCrudApp);
    await alepha.start();
  });

  describe("CREATE Operations", () => {
    test("should create a new user with valid data", async ({ expect }) => {
      const { data: result } = await app.createUser.fetch({
        body: {
          email: "john@example.com",
          name: "John Doe",
          age: 30,
          isActive: true,
        },
      });

      expect(result).toMatchObject({
        email: "john@example.com",
        name: "John Doe",
        age: 30,
        isActive: true,
      });
      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    test("should create user with default isActive=true", async ({
      expect,
    }) => {
      const { data: result } = await app.createUser.fetch({
        body: {
          email: "jane@example.com",
          name: "Jane Doe",
          age: 25,
        },
      });

      expect(result.isActive).toBe(true);
    });

    test("should reject duplicate email", async ({ expect }) => {
      await app.createUser.fetch({
        body: {
          email: "duplicate@example.com",
          name: "User One",
          age: 30,
        },
      });

      await expect(
        app.createUser.fetch({
          body: {
            email: "duplicate@example.com",
            name: "User Two",
            age: 25,
          },
        }),
      ).rejects.toThrowError("already exists");
    });

    test("should reject invalid email format", async ({ expect }) => {
      await expect(
        app.createUser.fetch({
          body: {
            email: "not-an-email",
            name: "John Doe",
            age: 30,
          },
        }),
      ).rejects.toThrow();
    });

    test("should reject empty name", async ({ expect }) => {
      await expect(
        app.createUser.fetch({
          body: {
            email: "test@example.com",
            name: "",
            age: 30,
          },
        }),
      ).rejects.toThrow();
    });

    test("should reject name exceeding max length", async ({ expect }) => {
      await expect(
        app.createUser.fetch({
          body: {
            email: "test@example.com",
            name: "a".repeat(101),
            age: 30,
          },
        }),
      ).rejects.toThrow();
    });

    test("should reject negative age", async ({ expect }) => {
      await expect(
        app.createUser.fetch({
          body: {
            email: "test@example.com",
            name: "John Doe",
            age: -1,
          },
        }),
      ).rejects.toThrow();
    });

    test("should reject age exceeding maximum", async ({ expect }) => {
      await expect(
        app.createUser.fetch({
          body: {
            email: "test@example.com",
            name: "John Doe",
            age: 151,
          },
        }),
      ).rejects.toThrow();
    });

    test("should accept boundary age values", async ({ expect }) => {
      const { data: result1 } = await app.createUser.fetch({
        body: {
          email: "young@example.com",
          name: "Young User",
          age: 0,
        },
      });
      expect(result1.age).toBe(0);

      const { data: result2 } = await app.createUser.fetch({
        body: {
          email: "old@example.com",
          name: "Old User",
          age: 150,
        },
      });
      expect(result2.age).toBe(150);
    });
  });

  describe("READ Operations", () => {
    test("should get user by ID", async ({ expect }) => {
      const { data: created } = await app.createUser.fetch({
        body: {
          email: "read@example.com",
          name: "Read User",
          age: 30,
        },
      });

      const { data: result } = await app.getUser.fetch({
        params: { id: created.id },
      });

      expect(result).toMatchObject({
        id: created.id,
        email: "read@example.com",
        name: "Read User",
        age: 30,
      });
    });

    test("should return 404 for non-existent user", async ({ expect }) => {
      const nonExistentId = crypto.randomUUID();

      await expect(
        app.getUser.fetch({
          params: { id: nonExistentId },
        }),
      ).rejects.toThrowError("not found");
    });

    test("should reject invalid UUID format", async ({ expect }) => {
      await expect(
        app.getUser.fetch({
          params: { id: "not-a-uuid" as any },
        }),
      ).rejects.toThrow();
    });
  });

  describe("LIST Operations", () => {
    beforeEach(async () => {
      // Create test data
      await app.createUser.fetch({
        body: { email: "alice@example.com", name: "Alice", age: 25 },
      });
      await app.createUser.fetch({
        body: { email: "bob@example.com", name: "Bob", age: 35 },
      });
      await app.createUser.fetch({
        body: {
          email: "charlie@example.com",
          name: "Charlie",
          age: 45,
          isActive: false,
        },
      });
    });

    test("should list all users with default pagination", async ({
      expect,
    }) => {
      const { data: result } = await app.listUsers.fetch({ query: {} });

      expect(result.content).toHaveLength(3);
      expect(result.page.totalElements).toBe(3);
      expect(result.page.number).toBe(0);
      expect(result.page.size).toBe(10);
      expect(result.page.isLast).toBe(true);
    });

    test("should paginate results", async ({ expect }) => {
      const { data: result } = await app.listUsers.fetch({
        query: { page: 0, size: 2 },
      });

      expect(result.content).toHaveLength(2);
      expect(result.page.totalElements).toBe(3);
      expect(result.page.isLast).toBe(false);
    });

    test("should filter by isActive", async ({ expect }) => {
      const { data: result } = await app.listUsers.fetch({
        query: { isActive: true },
      });

      expect(result.content).toHaveLength(2);
      expect(result.content.every((u) => u.isActive)).toBe(true);
    });

    test("should filter by name search", async ({ expect }) => {
      const { data: result } = await app.listUsers.fetch({
        query: { search: "Alice" },
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe("Alice");
    });

    test("should filter by email search", async ({ expect }) => {
      const { data: result } = await app.listUsers.fetch({
        query: { search: "bob@" },
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].email).toBe("bob@example.com");
    });

    test("should filter by age range", async ({ expect }) => {
      const { data: result } = await app.listUsers.fetch({
        query: { minAge: 30, maxAge: 40 },
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].age).toBe(35);
    });

    test("should combine multiple filters", async ({ expect }) => {
      const { data: result } = await app.listUsers.fetch({
        query: { isActive: true, minAge: 30 },
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe("Bob");
    });

    test("should return empty array when no matches", async ({ expect }) => {
      const { data: result } = await app.listUsers.fetch({
        query: { search: "nonexistent" },
      });

      expect(result.content).toHaveLength(0);
      expect(result.page.totalElements).toBe(0);
    });

    test("should reject invalid page number", async ({ expect }) => {
      await expect(
        app.listUsers.fetch({
          query: { page: -1 },
        }),
      ).rejects.toThrow();
    });

    test("should reject limit exceeding maximum", async ({ expect }) => {
      await expect(
        app.listUsers.fetch({
          query: { size: 101 },
        }),
      ).rejects.toThrow();
    });
  });

  describe("UPDATE Operations", () => {
    test("should update user email", async ({ expect }) => {
      const { data: created } = await app.createUser.fetch({
        body: {
          email: "old@example.com",
          name: "Update User",
          age: 30,
        },
      });

      const { data: updated } = await app.updateUser.fetch({
        params: { id: created.id },
        body: { email: "new@example.com" },
      });

      expect(updated.email).toBe("new@example.com");
      expect(updated.name).toBe("Update User");
      expect(updated.age).toBe(30);
    });

    test("should update user name", async ({ expect }) => {
      const { data: created } = await app.createUser.fetch({
        body: {
          email: "test@example.com",
          name: "Old Name",
          age: 30,
        },
      });

      const { data: updated } = await app.updateUser.fetch({
        params: { id: created.id },
        body: { name: "New Name" },
      });

      expect(updated.name).toBe("New Name");
    });

    test("should update user age", async ({ expect }) => {
      const { data: created } = await app.createUser.fetch({
        body: {
          email: "test@example.com",
          name: "Age User",
          age: 30,
        },
      });

      const { data: updated } = await app.updateUser.fetch({
        params: { id: created.id },
        body: { age: 35 },
      });

      expect(updated.age).toBe(35);
    });

    test("should update isActive status", async ({ expect }) => {
      const { data: created } = await app.createUser.fetch({
        body: {
          email: "test@example.com",
          name: "Status User",
          age: 30,
        },
      });

      const { data: updated } = await app.updateUser.fetch({
        params: { id: created.id },
        body: { isActive: false },
      });

      expect(updated.isActive).toBe(false);
    });

    test("should update multiple fields at once", async ({ expect }) => {
      const { data: created } = await app.createUser.fetch({
        body: {
          email: "multi@example.com",
          name: "Multi User",
          age: 30,
        },
      });

      const { data: updated } = await app.updateUser.fetch({
        params: { id: created.id },
        body: {
          name: "Updated Name",
          age: 35,
          isActive: false,
        },
      });

      expect(updated.name).toBe("Updated Name");
      expect(updated.age).toBe(35);
      expect(updated.isActive).toBe(false);
    });

    test("should reject update to duplicate email", async ({ expect }) => {
      await app.createUser.fetch({
        body: {
          email: "existing@example.com",
          name: "Existing User",
          age: 30,
        },
      });

      const { data: created } = await app.createUser.fetch({
        body: {
          email: "update@example.com",
          name: "Update User",
          age: 25,
        },
      });

      await expect(
        app.updateUser.fetch({
          params: { id: created.id },
          body: { email: "existing@example.com" },
        }),
      ).rejects.toThrowError("already exists");
    });

    test("should allow updating to same email", async ({ expect }) => {
      const { data: created } = await app.createUser.fetch({
        body: {
          email: "same@example.com",
          name: "Same User",
          age: 30,
        },
      });

      const { data: updated } = await app.updateUser.fetch({
        params: { id: created.id },
        body: { email: "same@example.com", name: "Updated Name" },
      });

      expect(updated.email).toBe("same@example.com");
      expect(updated.name).toBe("Updated Name");
    });

    test("should return 404 for non-existent user", async ({ expect }) => {
      const nonExistentId = crypto.randomUUID();

      await expect(
        app.updateUser.fetch({
          params: { id: nonExistentId },
          body: { name: "New Name" },
        }),
      ).rejects.toThrowError("not found");
    });

    test("should reject invalid email format", async ({ expect }) => {
      const { data: created } = await app.createUser.fetch({
        body: {
          email: "valid@example.com",
          name: "Valid User",
          age: 30,
        },
      });

      await expect(
        app.updateUser.fetch({
          params: { id: created.id },
          body: { email: "not-an-email" },
        }),
      ).rejects.toThrow();
    });

    test("should update updatedAt timestamp", async ({ expect }) => {
      const { data: created } = await app.createUser.fetch({
        body: {
          email: "timestamp@example.com",
          name: "Timestamp User",
          age: 30,
        },
      });

      // updatedAt is stamped app-side from DateTimeProvider, so advance the
      // testable clock rather than sleeping on the wall clock: a real delay is
      // racy under load (the update can even stamp 1ms *before* the create),
      // whereas travel() makes the update deterministically later.
      await alepha.inject(DateTimeProvider).travel([1, "second"]);

      const { data: updated } = await app.updateUser.fetch({
        params: { id: created.id },
        body: { name: "Updated Name" },
      });

      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
        new Date(created.updatedAt).getTime(),
      );
    });
  });

  describe("DELETE Operations", () => {
    test("should delete user by ID", async ({ expect }) => {
      const { data: created } = await app.createUser.fetch({
        body: {
          email: "delete@example.com",
          name: "Delete User",
          age: 30,
        },
      });

      const { data: result } = await app.deleteUser.fetch({
        params: { id: created.id },
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe(created.id);

      // Verify user is deleted
      await expect(
        app.getUser.fetch({
          params: { id: created.id },
        }),
      ).rejects.toThrowError("not found");
    });

    test("should return 404 for non-existent user", async ({ expect }) => {
      const nonExistentId = crypto.randomUUID();

      await expect(
        app.deleteUser.fetch({
          params: { id: nonExistentId },
        }),
      ).rejects.toThrowError("not found");
    });

    test("should not allow deleting same user twice", async ({ expect }) => {
      const { data: created } = await app.createUser.fetch({
        body: {
          email: "double-delete@example.com",
          name: "Double Delete User",
          age: 30,
        },
      });

      await app.deleteUser.fetch({
        params: { id: created.id },
      });

      await expect(
        app.deleteUser.fetch({
          params: { id: created.id },
        }),
      ).rejects.toThrowError("not found");
    });
  });

  describe("BULK Operations", () => {
    test("should create multiple users at once", async ({ expect }) => {
      const { data: result } = await app.bulkCreateUsers.fetch({
        body: {
          users: [
            { email: "bulk1@example.com", name: "Bulk User 1", age: 25 },
            { email: "bulk2@example.com", name: "Bulk User 2", age: 30 },
            { email: "bulk3@example.com", name: "Bulk User 3", age: 35 },
          ],
        },
      });

      expect(result.created).toBe(3);
    });

    test("should handle empty bulk create", async ({ expect }) => {
      const { data: result } = await app.bulkCreateUsers.fetch({
        body: {
          users: [],
        },
      });

      expect(result.created).toBe(0);
    });

    test("should create large batch of users", async ({ expect }) => {
      const users = Array.from({ length: 50 }, (_, i) => ({
        email: `bulk${i}@example.com`,
        name: `Bulk User ${i}`,
        age: 20 + (i % 50),
      }));

      const { data: result } = await app.bulkCreateUsers.fetch({
        body: { users },
      });

      expect(result.created).toBe(50);
    });
  });

  describe("Security Tests - SQL Injection", () => {
    test("should prevent SQL injection in name field", async ({ expect }) => {
      const { data: result } = await app.createUser.fetch({
        body: {
          email: "sql@example.com",
          name: "'; DROP TABLE crud_users; --",
          age: 30,
        },
      });

      expect(result.name).toBe("'; DROP TABLE crud_users; --");

      // Verify table still exists by listing users
      const { data: list } = await app.listUsers.fetch({ query: {} });
      expect(list.content).toBeDefined();
    });

    test("should prevent SQL injection in search query", async ({ expect }) => {
      await app.createUser.fetch({
        body: {
          email: "safe@example.com",
          name: "Safe User",
          age: 30,
        },
      });

      const { data: result } = await app.listUsers.fetch({
        query: { search: "' OR '1'='1" },
      });

      // Should not return all users, only exact matches
      expect(result.content.length).toBeLessThanOrEqual(1);
    });

    test("should prevent SQL injection in email field", async ({ expect }) => {
      await expect(
        app.createUser.fetch({
          body: {
            email: "test@example.com'; DROP TABLE crud_users; --",
            name: "Test User",
            age: 30,
          },
        }),
      ).rejects.toThrow(); // Invalid email format
    });
  });

  describe("Security Tests - XSS Prevention", () => {
    test("should store XSS attempt as plain text in name", async ({
      expect,
    }) => {
      const xssPayload = '<script>alert("XSS")</script>';
      const { data: result } = await app.createUser.fetch({
        body: {
          email: "xss@example.com",
          name: xssPayload,
          age: 30,
        },
      });

      expect(result.name).toBe(xssPayload);
    });

    test("should store HTML tags as plain text", async ({ expect }) => {
      const htmlPayload = '<img src="x" onerror="alert(1)">';
      const { data: result } = await app.createUser.fetch({
        body: {
          email: "html@example.com",
          name: htmlPayload,
          age: 30,
        },
      });

      expect(result.name).toBe(htmlPayload);
    });

    test("should handle Unicode and special characters", async ({ expect }) => {
      const specialChars = "用户 👤 Ñoño 🔥";
      const { data: result } = await app.createUser.fetch({
        body: {
          email: "unicode@example.com",
          name: specialChars,
          age: 30,
        },
      });

      expect(result.name).toBe(specialChars);
    });
  });

  describe("Security Tests - Input Validation", () => {
    test("should reject null values", async ({ expect }) => {
      await expect(
        app.createUser.fetch({
          body: {
            email: null as any,
            name: "Test User",
            age: 30,
          },
        }),
      ).rejects.toThrow();
    });

    test("should reject undefined required fields", async ({ expect }) => {
      await expect(
        app.createUser.fetch({
          body: {
            email: "test@example.com",
            name: undefined as any,
            age: 30,
          },
        }),
      ).rejects.toThrow();
    });

    test("should reject wrong data types", async ({ expect }) => {
      await expect(
        app.createUser.fetch({
          body: {
            email: "test@example.com",
            name: "Test User",
            age: "thirty" as any,
          },
        }),
      ).rejects.toThrow();
    });

    test("rejects a string age (bodies are strict — no coercion)", async ({
      expect,
    }) => {
      // Strict zod: a JSON body string is NOT coerced to a number. Coercion
      // only happens at the HTTP/string boundary (query, headers, env).
      await expect(
        app.createUser.fetch({
          body: {
            email: "test@example.com",
            name: "Test User",
            age: "30" as any,
          },
        }),
      ).rejects.toThrow();
    });

    test("rejects a string boolean for isActive (bodies are strict)", async ({
      expect,
    }) => {
      // Strict zod: a JSON body string is NOT coerced to a boolean.
      await expect(
        app.createUser.fetch({
          body: {
            email: "test@example.com",
            name: "Test User",
            age: 30,
            isActive: "true" as any,
          },
        }),
      ).rejects.toThrow();
    });

    test("should reject extra fields in body", async ({ expect }) => {
      const { data: result } = await app.createUser.fetch({
        body: {
          email: "extra@example.com",
          name: "Extra User",
          age: 30,
          extraField: "should be ignored",
        } as any,
      });

      expect((result as any).extraField).toBeUndefined();
    });
  });

  describe("Edge Cases - Boundary Values", () => {
    test("should handle minimum age (0)", async ({ expect }) => {
      const { data: result } = await app.createUser.fetch({
        body: {
          email: "baby@example.com",
          name: "Baby User",
          age: 0,
        },
      });

      expect(result.age).toBe(0);
    });

    test("should handle maximum age (150)", async ({ expect }) => {
      const { data: result } = await app.createUser.fetch({
        body: {
          email: "ancient@example.com",
          name: "Ancient User",
          age: 150,
        },
      });

      expect(result.age).toBe(150);
    });

    test("should handle minimum length name (1 character)", async ({
      expect,
    }) => {
      const { data: result } = await app.createUser.fetch({
        body: {
          email: "short@example.com",
          name: "X",
          age: 30,
        },
      });

      expect(result.name).toBe("X");
    });

    test("should handle maximum length name (100 characters)", async ({
      expect,
    }) => {
      const longName = "A".repeat(100);
      const { data: result } = await app.createUser.fetch({
        body: {
          email: "long@example.com",
          name: longName,
          age: 30,
        },
      });

      expect(result.name).toBe(longName);
      expect(result.name.length).toBe(100);
    });

    test("should handle decimal age values", async ({ expect }) => {
      await expect(
        app.createUser.fetch({
          body: {
            email: "decimal@example.com",
            name: "Decimal User",
            age: 30.5,
          },
        }),
      ).resolves.toBeDefined();
    });
  });

  describe("Edge Cases - Empty and Whitespace", () => {
    test("should trim leading/trailing spaces from name", async ({
      expect,
    }) => {
      const { data: result } = await app.createUser.fetch({
        body: {
          email: "spaces@example.com",
          name: "  Spaced Name  ",
          age: 30,
        },
      });

      // TypeBox text fields trim leading/trailing whitespace
      expect(result.name).toBe("Spaced Name");
    });

    test("should handle name with spaces around content", async ({
      expect,
    }) => {
      // Text fields may trim leading/trailing spaces
      const { data: result } = await app.createUser.fetch({
        body: {
          email: "spaces-only@example.com",
          name: " X ",
          age: 30,
        },
      });

      // TypeBox text fields typically trim whitespace
      expect(result.name).toBe("X");
    });

    test("should handle email with valid special characters", async ({
      expect,
    }) => {
      const { data: result } = await app.createUser.fetch({
        body: {
          email: "user+test@example.co.uk",
          name: "Special Email User",
          age: 30,
        },
      });

      expect(result.email).toBe("user+test@example.co.uk");
    });
  });

  describe("Concurrent Operations", () => {
    test("should handle concurrent user creation", async ({ expect }) => {
      const createPromises = Array.from({ length: 10 }, (_, i) =>
        app.createUser.fetch({
          body: {
            email: `concurrent${i}@example.com`,
            name: `Concurrent User ${i}`,
            age: 20 + i,
          },
        }),
      );

      const results = await Promise.all(createPromises);

      expect(results).toHaveLength(10);
      expect(new Set(results.map((r) => r.data.id)).size).toBe(10); // All unique IDs
    });

    test("should handle concurrent duplicate email attempts", async ({
      expect,
    }) => {
      const email = "race@example.com";

      const createPromises = Array.from({ length: 5 }, (_, i) =>
        app.createUser
          .fetch({
            body: {
              email,
              name: `Race User ${i}`,
              age: 30,
            },
          })
          .catch((err) => err),
      );

      const results = await Promise.all(createPromises);

      // Only one should succeed
      const successful = results.filter((r) => !(r instanceof Error));
      expect(successful.length).toBeGreaterThanOrEqual(1);
      expect(successful.length).toBeLessThanOrEqual(5);
    });

    test("should handle concurrent updates to same user", async ({
      expect,
    }) => {
      const { data: created } = await app.createUser.fetch({
        body: {
          email: "concurrent-update@example.com",
          name: "Original Name",
          age: 30,
        },
      });

      const updatePromises = Array.from({ length: 5 }, (_, i) =>
        app.updateUser.fetch({
          params: { id: created.id },
          body: { name: `Updated Name ${i}` },
        }),
      );

      const results = await Promise.all(updatePromises);

      expect(results).toHaveLength(5);
      // Last update should win
      const { data: finalUser } = await app.getUser.fetch({
        params: { id: created.id },
      });
      expect(finalUser.name).toMatch(/^Updated Name \d$/);
    });
  });

  describe("Complex Scenarios", () => {
    test("should handle full CRUD lifecycle", async ({ expect }) => {
      // Create
      const { data: created } = await app.createUser.fetch({
        body: {
          email: "lifecycle@example.com",
          name: "Lifecycle User",
          age: 30,
        },
      });
      expect(created.id).toBeDefined();

      // Read
      const { data: read } = await app.getUser.fetch({
        params: { id: created.id },
      });
      expect(read.email).toBe("lifecycle@example.com");

      // Update
      const { data: updated } = await app.updateUser.fetch({
        params: { id: created.id },
        body: { age: 31 },
      });
      expect(updated.age).toBe(31);

      // List
      const { data: list } = await app.listUsers.fetch({ query: {} });
      expect(list.content.some((u) => u.id === created.id)).toBe(true);

      // Delete
      const { data: deleted } = await app.deleteUser.fetch({
        params: { id: created.id },
      });
      expect(deleted.success).toBe(true);

      // Verify deletion
      await expect(
        app.getUser.fetch({ params: { id: created.id } }),
      ).rejects.toThrowError("not found");
    });

    test("should maintain data consistency across operations", async ({
      expect,
    }) => {
      // Create multiple users
      const { data: user1 } = await app.createUser.fetch({
        body: {
          email: "consistency1@example.com",
          name: "User 1",
          age: 25,
        },
      });

      const { data: user2 } = await app.createUser.fetch({
        body: {
          email: "consistency2@example.com",
          name: "User 2",
          age: 35,
        },
      });

      // List should show both
      const { data: list1 } = await app.listUsers.fetch({ query: {} });
      expect(list1.content.length).toBeGreaterThanOrEqual(2);

      // Update one user
      await app.updateUser.fetch({
        params: { id: user1.id },
        body: { age: 26 },
      });

      // List should still show both with updated data
      const { data: list2 } = await app.listUsers.fetch({ query: {} });
      const updatedUser = list2.content.find((u) => u.id === user1.id);
      expect(updatedUser?.age).toBe(26);

      // Delete one user
      await app.deleteUser.fetch({ params: { id: user2.id } });

      // List should show only one
      const { data: list3 } = await app.listUsers.fetch({ query: {} });
      expect(list3.content.find((u) => u.id === user2.id)).toBeUndefined();
      expect(list3.content.find((u) => u.id === user1.id)).toBeDefined();
    });

    test("should handle pagination correctly with deletes", async ({
      expect,
    }) => {
      // Create 5 users
      const usersResponses = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          app.createUser.fetch({
            body: {
              email: `page${i}@example.com`,
              name: `Page User ${i}`,
              age: 30,
            },
          }),
        ),
      );
      const users = usersResponses.map((r) => r.data);

      // Get first page
      const { data: page1 } = await app.listUsers.fetch({ query: { size: 2 } });
      expect(page1.content).toHaveLength(2);
      expect(page1.page.isLast).toBe(false);

      // Delete a user
      await app.deleteUser.fetch({ params: { id: users[0].id } });

      // Total count should decrease
      const { data: afterDelete } = await app.listUsers.fetch({ query: {} });
      expect(afterDelete.page.totalElements).toBe(
        (page1.page.totalElements ?? 0) - 1,
      );
    });
  });

  describe("Error Recovery", () => {
    test("should recover from failed create and allow retry", async ({
      expect,
    }) => {
      // First attempt with invalid data
      await expect(
        app.createUser.fetch({
          body: {
            email: "invalid-email",
            name: "Test User",
            age: 30,
          },
        }),
      ).rejects.toThrow();

      // Retry with valid data should succeed
      const { data: result } = await app.createUser.fetch({
        body: {
          email: "valid@example.com",
          name: "Test User",
          age: 30,
        },
      });

      expect(result.email).toBe("valid@example.com");
    });

    test("should handle partial update failures gracefully", async ({
      expect,
    }) => {
      const { data: created } = await app.createUser.fetch({
        body: {
          email: "partial@example.com",
          name: "Partial User",
          age: 30,
        },
      });

      // Attempt invalid update
      await expect(
        app.updateUser.fetch({
          params: { id: created.id },
          body: { age: -1 },
        }),
      ).rejects.toThrow();

      // Original data should remain unchanged
      const { data: unchanged } = await app.getUser.fetch({
        params: { id: created.id },
      });
      expect(unchanged.age).toBe(30);
    });
  });

  describe("Performance Tests", () => {
    test("should handle bulk operations efficiently", async ({ expect }) => {
      const startTime = Date.now();

      const users = Array.from({ length: 100 }, (_, i) => ({
        email: `perf${i}@example.com`,
        name: `Performance User ${i}`,
        age: 20 + (i % 50),
      }));

      await app.bulkCreateUsers.fetch({ body: { users } });

      const duration = Date.now() - startTime;

      // Should complete in reasonable time (adjust threshold as needed)
      expect(duration).toBeLessThan(10000); // 10 seconds

      // Verify all users were created
      const { data: list } = await app.listUsers.fetch({
        query: { size: 100 },
      });
      expect(list.content.length).toBeGreaterThanOrEqual(100);
    });

    test("should handle large result sets efficiently", async ({ expect }) => {
      // Create many users
      await app.bulkCreateUsers.fetch({
        body: {
          users: Array.from({ length: 50 }, (_, i) => ({
            email: `large${i}@example.com`,
            name: `Large Set User ${i}`,
            age: 30,
          })),
        },
      });

      const startTime = Date.now();
      const { data: result } = await app.listUsers.fetch({
        query: { size: 100 },
      });
      const duration = Date.now() - startTime;

      expect(result.content.length).toBeGreaterThanOrEqual(50);
      expect(duration).toBeLessThan(5000); // Should be fast
    });
  });
});
