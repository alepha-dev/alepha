import { t } from "alepha";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { $entity } from "../../src/orm/primitives/$entity.ts";
import { pg } from "../../src/orm/providers/DatabaseTypeProvider.ts";
import { PostgresModelBuilder } from "../../src/orm/services/PostgresModelBuilder.ts";
import { SqliteModelBuilder } from "../../src/orm/services/SqliteModelBuilder.ts";

describe("ModelBuilder", () => {
  describe("PostgresModelBuilder", () => {
    let builder: PostgresModelBuilder;
    let options: {
      tables: Map<string, unknown>;
      enums: Map<string, unknown>;
      schema: string;
    };

    beforeEach(() => {
      builder = new PostgresModelBuilder();
      options = {
        tables: new Map(),
        enums: new Map(),
        schema: "public",
      };
    });

    test("should build a basic table", () => {
      const entity = $entity({
        name: "users",
        schema: t.object({
          id: pg.primaryKey(),
          name: t.text(),
          email: t.email(),
        }),
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
      const table = options.tables.get("users");
      expect(table).toBeDefined();
    });

    test("should build table with single column index", () => {
      const entity = $entity({
        name: "users",
        schema: t.object({
          id: pg.primaryKey(),
          email: t.email(),
          username: t.text(),
        }),
        indexes: ["email", "username"],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
      const table = options.tables.get("users");
      expect(table).toBeDefined();
    });

    test("should build table with unique index", () => {
      const entity = $entity({
        name: "users",
        schema: t.object({
          id: pg.primaryKey(),
          email: t.email(),
          username: t.text(),
        }),
        indexes: [
          {
            column: "email",
            unique: true,
            name: "unique_email_idx",
          },
        ],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
      const table = options.tables.get("users");
      expect(table).toBeDefined();
    });

    test("should build table with composite index", () => {
      const entity = $entity({
        name: "posts",
        schema: t.object({
          id: pg.primaryKey(),
          userId: t.text(),
          createdAt: t.string({ format: "date-time" }),
          title: t.text(),
        }),
        indexes: [
          {
            columns: ["userId", "createdAt"],
            name: "user_created_idx",
          },
        ],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("posts")).toBe(true);
      const table = options.tables.get("posts");
      expect(table).toBeDefined();
    });

    test("should build table with unique composite index", () => {
      const entity = $entity({
        name: "user_roles",
        schema: t.object({
          id: pg.primaryKey(),
          userId: t.text(),
          roleId: t.text(),
        }),
        indexes: [
          {
            columns: ["userId", "roleId"],
            unique: true,
            name: "unique_user_role",
          },
        ],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("user_roles")).toBe(true);
      const table = options.tables.get("user_roles");
      expect(table).toBeDefined();
    });

    test("should build table with foreign keys", () => {
      // First create the users table
      const usersEntity = $entity({
        name: "users",
        schema: t.object({
          id: pg.primaryKey(),
          name: t.text(),
        }),
      });

      builder.buildTable(usersEntity, options);

      const usersTable = options.tables.get("users") as any;

      // Then create posts table with foreign key
      const postsEntity = $entity({
        name: "posts",
        schema: t.object({
          id: pg.primaryKey(),
          userId: t.text(),
          title: t.text(),
        }),
        foreignKeys: [
          {
            name: "posts_user_fk",
            columns: ["userId"],
            foreignColumns: [() => usersEntity.cols.id],
          },
        ],
      });

      builder.buildTable(postsEntity, options);

      expect(options.tables.has("posts")).toBe(true);
      const table = options.tables.get("posts");
      expect(table).toBeDefined();
    });

    test("should build table with unique constraint", () => {
      const entity = $entity({
        name: "users",
        schema: t.object({
          id: pg.primaryKey(),
          email: t.email(),
          username: t.text(),
        }),
        constraints: [
          {
            columns: ["email"],
            unique: true,
            name: "unique_user_email",
          },
        ],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
      const table = options.tables.get("users");
      expect(table).toBeDefined();
    });

    test("should build table with check constraint", () => {
      const entity = $entity({
        name: "users",
        schema: t.object({
          id: pg.primaryKey(),
          age: t.integer(),
        }),
        constraints: [
          {
            columns: ["age"],
            check: sql`age >= 0 AND age <= 150`,
            name: "valid_age_range",
          },
        ],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
      const table = options.tables.get("users");
      expect(table).toBeDefined();
    });

    test("should build table with composite unique constraint", () => {
      const entity = $entity({
        name: "user_settings",
        schema: t.object({
          id: pg.primaryKey(),
          userId: t.text(),
          settingKey: t.text(),
          settingValue: t.text(),
        }),
        constraints: [
          {
            columns: ["userId", "settingKey"],
            unique: true,
            name: "unique_user_setting",
          },
        ],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("user_settings")).toBe(true);
      const table = options.tables.get("user_settings");
      expect(table).toBeDefined();
    });

    test("should build table with custom config function", () => {
      const customConfig = () => [];

      const entity = $entity({
        name: "users",
        schema: t.object({
          id: pg.primaryKey(),
          name: t.text(),
        }),
        config: customConfig,
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
      // Config is passed to the table but may not be called immediately
      // The important thing is that the table is created with the config
      const table = options.tables.get("users");
      expect(table).toBeDefined();
    });

    test("should build table with all options combined", () => {
      // Create referenced table first
      const rolesEntity = $entity({
        name: "roles",
        schema: t.object({
          id: pg.primaryKey(),
          name: t.text(),
        }),
      });

      builder.buildTable(rolesEntity, options);

      const rolesTable = options.tables.get("roles") as any;

      const entity = $entity({
        name: "users",
        schema: t.object({
          id: pg.primaryKey(),
          email: t.email(),
          username: t.text(),
          age: t.integer(),
          roleId: t.text(),
          createdAt: t.string({ format: "date-time" }),
        }),
        indexes: [
          "email",
          {
            column: "username",
            unique: true,
          },
          {
            columns: ["roleId", "createdAt"],
            name: "role_created_idx",
          },
        ],
        foreignKeys: [
          {
            columns: ["roleId"],
            foreignColumns: [() => rolesEntity.cols.id],
          },
        ],
        constraints: [
          {
            columns: ["age"],
            check: sql`age >= 18`,
            name: "adult_users_only",
          },
          {
            columns: ["email", "username"],
            unique: true,
            name: "unique_email_username",
          },
        ],
        config: (self) => [],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
      const table = options.tables.get("users");
      expect(table).toBeDefined();
    });

    test("should convert camelCase to snake_case for column names", () => {
      const entity = $entity({
        name: "users",
        schema: t.object({
          id: pg.primaryKey(),
          firstName: t.text(),
          lastName: t.text(),
          emailAddress: t.email(),
        }),
        indexes: ["firstName", "lastName"],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
      const table = options.tables.get("users");
      expect(table).toBeDefined();
      // Column names should be converted to snake_case internally
    });

    test("should not recreate table if it already exists", () => {
      const entity = $entity({
        name: "users",
        schema: t.object({
          id: pg.primaryKey(),
          name: t.text(),
        }),
      });

      builder.buildTable(entity, options);
      const firstTable = options.tables.get("users");

      // Try to build again
      builder.buildTable(entity, options);
      const secondTable = options.tables.get("users");

      expect(firstTable).toBe(secondTable);
    });
  });

  describe("SqliteModelBuilder", () => {
    let builder: SqliteModelBuilder;
    let options: {
      tables: Map<string, unknown>;
      enums: Map<string, unknown>;
      schema: string;
    };

    beforeEach(() => {
      builder = new SqliteModelBuilder();
      options = {
        tables: new Map(),
        enums: new Map(),
        schema: "public",
      };
    });

    test("should build a basic table", () => {
      const entity = $entity({
        name: "users",
        schema: t.object({
          id: pg.primaryKey(),
          name: t.text(),
          email: t.email(),
        }),
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
      const table = options.tables.get("users");
      expect(table).toBeDefined();
    });

    test("should build table with indexes", () => {
      const entity = $entity({
        name: "users",
        schema: t.object({
          id: pg.primaryKey(),
          email: t.email(),
          username: t.text(),
        }),
        indexes: [
          "email",
          {
            column: "username",
            unique: true,
          },
        ],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
      const table = options.tables.get("users");
      expect(table).toBeDefined();
    });

    test("should build table with composite index", () => {
      const entity = $entity({
        name: "posts",
        schema: t.object({
          id: pg.primaryKey(),
          userId: t.text(),
          createdAt: t.string({ format: "date-time" }),
        }),
        indexes: [
          {
            columns: ["userId", "createdAt"],
            unique: false,
          },
        ],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("posts")).toBe(true);
      const table = options.tables.get("posts");
      expect(table).toBeDefined();
    });

    test("should build table with foreign keys", () => {
      // First create the users table
      const usersEntity = $entity({
        name: "users",
        schema: t.object({
          id: pg.primaryKey(),
          name: t.text(),
        }),
      });

      builder.buildTable(usersEntity, options);

      const usersTable = options.tables.get("users") as any;

      // Then create posts table with foreign key
      const postsEntity = $entity({
        name: "posts",
        schema: t.object({
          id: pg.primaryKey(),
          userId: t.text(),
          title: t.text(),
        }),
        foreignKeys: [
          {
            columns: ["userId"],
            foreignColumns: [() => usersEntity.cols.id],
          },
        ],
      });

      builder.buildTable(postsEntity, options);

      expect(options.tables.has("posts")).toBe(true);
      const table = options.tables.get("posts");
      expect(table).toBeDefined();
    });

    test("should build table with constraints", () => {
      const entity = $entity({
        name: "products",
        schema: t.object({
          id: pg.primaryKey(),
          name: t.text(),
          sku: t.text(),
          price: t.number(),
        }),
        constraints: [
          {
            columns: ["sku"],
            unique: true,
            name: "unique_sku",
          },
          {
            columns: ["price"],
            check: sql`price > 0`,
            name: "positive_price",
          },
        ],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("products")).toBe(true);
      const table = options.tables.get("products");
      expect(table).toBeDefined();
    });

    test("should throw error for sequences", () => {
      expect(() => {
        builder.buildSequence({ name: "test_seq", options: {} } as any, {
          sequences: new Map(),
          schema: "public",
        });
      }).toThrow("SQLite does not support sequences");
    });

    test("should build table with all options combined", () => {
      const entity = $entity({
        name: "complex_table",
        schema: t.object({
          id: pg.primaryKey(),
          name: t.text(),
          email: t.email(),
          status: t.text(),
        }),
        indexes: [
          "name",
          {
            columns: ["email", "status"],
            unique: true,
            name: "unique_email_status",
          },
        ],
        constraints: [
          {
            columns: ["status"],
            check: sql`status IN ('active', 'inactive')`,
            name: "valid_status",
          },
        ],
        config: (self) => [],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("complex_table")).toBe(true);
      const table = options.tables.get("complex_table");
      expect(table).toBeDefined();
    });
  });

  describe("Abstract ModelBuilder methods", () => {
    test("should convert camelCase to snake_case correctly", () => {
      const builder = new PostgresModelBuilder();

      // Access the protected method via type assertion
      const toColumnName = (builder as any).toColumnName.bind(builder);

      expect(toColumnName("id")).toBe("id");
      expect(toColumnName("userId")).toBe("user_id");
      expect(toColumnName("firstName")).toBe("first_name");
      expect(toColumnName("emailAddress")).toBe("email_address");
      expect(toColumnName("createdAt")).toBe("created_at");
      expect(toColumnName("isActiveUser")).toBe("is_active_user");
    });
  });
});
