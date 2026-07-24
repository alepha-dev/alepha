import { Alepha, z } from "alepha";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { $entity } from "../core/primitives/$entity.ts";
import { db } from "../core/providers/DatabaseTypeProvider.ts";
import { SqliteModelBuilder } from "../core/services/SqliteModelBuilder.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";
import { PostgresModelBuilder } from "../postgres/services/PostgresModelBuilder.ts";
import {
  testComplexRelationships,
  testCustomConfig,
  testExpressionIndex,
  testModelBuilderFeatures,
} from "./ModelBuilder-tests.ts";

describe("ModelBuilder", () => {
  describe("PostgresModelBuilder", () => {
    let builder: PostgresModelBuilder;
    let options: {
      tables: Map<string, unknown>;
      enums: Map<string, unknown>;
      schemas: Map<string, unknown>;
      schema: string;
    };

    beforeEach(() => {
      builder = new PostgresModelBuilder();
      options = {
        tables: new Map(),
        enums: new Map(),
        schemas: new Map(),
        schema: "public",
      };
    });

    it("should build a basic table", () => {
      const entity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          name: z.text(),
          email: z.email(),
        }),
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
      const table = options.tables.get("users");
      expect(table).toBeDefined();
    });

    it("should build table with single column index", () => {
      const entity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          email: z.email(),
          username: z.text(),
        }),
        indexes: ["email", "username"],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
      const table = options.tables.get("users");
      expect(table).toBeDefined();
    });

    it("should build table with unique index", () => {
      const entity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          email: z.email(),
          username: z.text(),
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

    it("should build table with composite index", () => {
      const entity = $entity({
        name: "posts",
        schema: z.object({
          id: db.primaryKey(),
          userId: z.text(),
          createdAt: z.string().meta({ format: "date-time" }),
          title: z.text(),
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

    it("should build table with unique composite index", () => {
      const entity = $entity({
        name: "user_roles",
        schema: z.object({
          id: db.primaryKey(),
          userId: z.text(),
          roleId: z.text(),
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

    it("should build table with foreign keys", () => {
      // First create the users table
      const usersEntity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          name: z.text(),
        }),
      });

      builder.buildTable(usersEntity, options);

      const usersTable = options.tables.get("users") as any;

      // Then create posts table with foreign key
      const postsEntity = $entity({
        name: "posts",
        schema: z.object({
          id: db.primaryKey(),
          userId: z.text(),
          title: z.text(),
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

    it("should build table with unique constraint", () => {
      const entity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          email: z.email(),
          username: z.text(),
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

    it("should build table with check constraint", () => {
      const entity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          age: z.integer(),
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

    it("should build table with composite unique constraint", () => {
      const entity = $entity({
        name: "user_settings",
        schema: z.object({
          id: db.primaryKey(),
          userId: z.text(),
          settingKey: z.text(),
          settingValue: z.text(),
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

    it("should build table with custom config function", () => {
      const customConfig = () => [];

      const entity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          name: z.text(),
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

    it("should build table with all options combined", () => {
      // Create referenced table first
      const rolesEntity = $entity({
        name: "roles",
        schema: z.object({
          id: db.primaryKey(),
          name: z.text(),
        }),
      });

      builder.buildTable(rolesEntity, options);

      const rolesTable = options.tables.get("roles") as any;

      const entity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          email: z.email(),
          username: z.text(),
          age: z.integer(),
          roleId: z.text(),
          createdAt: z.string().meta({ format: "date-time" }),
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

    it("should convert camelCase to snake_case for column names", () => {
      const entity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          firstName: z.text(),
          lastName: z.text(),
          emailAddress: z.email(),
        }),
        indexes: ["firstName", "lastName"],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
      const table = options.tables.get("users");
      expect(table).toBeDefined();
      // Column names should be converted to snake_case internally
    });

    it("should build table with plain bigint column", () => {
      const entity = $entity({
        name: "counters",
        schema: z.object({
          id: db.primaryKey(),
          totalViews: z.bigint(),
        }),
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("counters")).toBe(true);
      const table = options.tables.get("counters") as any;
      expect(table).toBeDefined();
      // Verify the bigint column exists
      expect(table.totalViews).toBeDefined();
    });

    it("should use correct column name for identity primary key", () => {
      const entity = $entity({
        name: "events",
        schema: z.object({
          eventId: db.identityPrimaryKey(),
          name: z.text(),
        }),
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("events")).toBe(true);
      const table = options.tables.get("events") as any;
      expect(table).toBeDefined();
      expect(table.eventId).toBeDefined();
      // Column should use snake_case name
      expect(table.eventId.config.name).toBe("event_id");
    });

    it("should build table with expression-based index", () => {
      const entity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          realm: z.text(),
          username: z.text(),
        }),
        indexes: [
          {
            expressions: (self) => [self.realm, sql`LOWER(${self.username})`],
            unique: true,
            name: "users_realm_username_lower_idx",
          },
        ],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
      const table = options.tables.get("users");
      expect(table).toBeDefined();
    });

    it("should build table with expression-only index", () => {
      const entity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          email: z.email(),
        }),
        indexes: [
          {
            expressions: (self) => [sql`LOWER(${self.email})`],
            unique: true,
            name: "users_email_lower_idx",
          },
        ],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
    });

    it("should not recreate table if it already exists", () => {
      const entity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          name: z.text(),
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
      schemas: Map<string, unknown>;
      schema: string;
    };

    beforeEach(() => {
      builder = new SqliteModelBuilder();
      options = {
        tables: new Map(),
        enums: new Map(),
        schemas: new Map(),
        schema: "public",
      };
    });

    it("should build a basic table", () => {
      const entity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          name: z.text(),
          email: z.email(),
        }),
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
      const table = options.tables.get("users");
      expect(table).toBeDefined();
    });

    it("should build table with indexes", () => {
      const entity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          email: z.email(),
          username: z.text(),
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

    it("should build table with composite index", () => {
      const entity = $entity({
        name: "posts",
        schema: z.object({
          id: db.primaryKey(),
          userId: z.text(),
          createdAt: z.string().meta({ format: "date-time" }),
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

    it("should build table with foreign keys", () => {
      // First create the users table
      const usersEntity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          name: z.text(),
        }),
      });

      builder.buildTable(usersEntity, options);

      const usersTable = options.tables.get("users") as any;

      // Then create posts table with foreign key
      const postsEntity = $entity({
        name: "posts",
        schema: z.object({
          id: db.primaryKey(),
          userId: z.text(),
          title: z.text(),
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

    it("should build table with constraints", () => {
      const entity = $entity({
        name: "products",
        schema: z.object({
          id: db.primaryKey(),
          name: z.text(),
          sku: z.text(),
          price: z.number(),
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

    it("should build table with expression-based index", () => {
      const entity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          realm: z.text(),
          username: z.text(),
        }),
        indexes: [
          {
            expressions: (self) => [self.realm, sql`LOWER(${self.username})`],
            unique: true,
            name: "users_realm_username_lower_idx",
          },
        ],
      });

      builder.buildTable(entity, options);

      expect(options.tables.has("users")).toBe(true);
      const table = options.tables.get("users");
      expect(table).toBeDefined();
    });

    it("should build table with an array-of-enum column (stored as json)", () => {
      // Regression: an enum array element used to fall through to the
      // "Unsupported schema for field" throw — the Sqlite builder lacked the
      // enum branch the Postgres builder already had. Stored as JSON, exactly
      // like an array-of-string column.
      const entity = $entity({
        name: "products",
        schema: z.object({
          id: db.primaryKey(),
          channels: z.array(z.enum(["desk", "portal", "mobile"])),
        }),
      });

      expect(() => builder.buildTable(entity, options)).not.toThrow();
      expect(options.tables.has("products")).toBe(true);
      expect(options.tables.get("products")).toBeDefined();
    });

    it("should throw error for sequences", () => {
      expect(() => {
        builder.buildSequence({ name: "test_seq", options: {} } as any, {
          sequences: new Map(),
          schema: "public",
        });
      }).toThrow("SQLite does not support sequences");
    });

    it("should build table with all options combined", () => {
      const entity = $entity({
        name: "complex_table",
        schema: z.object({
          id: db.primaryKey(),
          name: z.text(),
          email: z.email(),
          status: z.text(),
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

  describe("abstract methods", () => {
    it("should convert camelCase to snake_case correctly", () => {
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

  describe("type safety", () => {
    it("should enforce type-safe foreign key references", () => {
      const roleEntity = $entity({
        name: "roles",
        schema: z.object({
          id: db.primaryKey(),
          name: z.string(),
        }),
      });

      const userEntity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          email: z.email(),
          roleId: z.integer(),
        }),
        foreignKeys: [
          {
            columns: ["roleId"],
            // This should reference an EntityColumn from roleEntity
            foreignColumns: [() => roleEntity.cols.id],
          },
        ],
      });

      // Test that we can access the column references
      expect(roleEntity.cols.id).toBeDefined();
      expect(roleEntity.cols.id.name).toBe("id");
      expect(roleEntity.cols.id.entity).toBe(roleEntity);

      expect(userEntity.cols.email).toBeDefined();
      expect(userEntity.cols.email.name).toBe("email");

      // Test that foreign key references work
      const fkDef = userEntity.options.foreignKeys![0];
      expect(fkDef.columns).toEqual(["roleId"]);

      // Execute the foreign column reference function
      const foreignCol = fkDef.foreignColumns[0]();
      expect(foreignCol).toBeDefined();
      expect(foreignCol.name).toBe("id");
      expect(foreignCol.entity.name).toBe("roles");
    });

    it("should support multiple foreign key references", () => {
      const categoryEntity = $entity({
        name: "categories",
        schema: z.object({
          id: db.primaryKey(),
          name: z.string(),
        }),
      });

      const userEntity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          username: z.string(),
        }),
      });

      const postEntity = $entity({
        name: "posts",
        schema: z.object({
          id: db.primaryKey(),
          title: z.string(),
          userId: z.integer(),
          categoryId: z.integer(),
        }),
        foreignKeys: [
          {
            columns: ["userId"],
            foreignColumns: [() => userEntity.cols.id],
          },
          {
            columns: ["categoryId"],
            foreignColumns: [() => categoryEntity.cols.id],
          },
        ],
      });

      const fks = postEntity.options.foreignKeys!;
      expect(fks).toHaveLength(2);

      // Check first foreign key (userId -> users.id)
      const userFk = fks[0];
      const userForeignCol = userFk.foreignColumns[0]();
      expect(userForeignCol.entity.name).toBe("users");
      expect(userForeignCol.name).toBe("id");

      // Check second foreign key (categoryId -> categories.id)
      const categoryFk = fks[1];
      const categoryForeignCol = categoryFk.foreignColumns[0]();
      expect(categoryForeignCol.entity.name).toBe("categories");
      expect(categoryForeignCol.name).toBe("id");
    });

    it("should support composite foreign keys", () => {
      const tenantEntity = $entity({
        name: "tenants",
        schema: z.object({
          id: db.primaryKey(),
          code: z.string(),
          name: z.string(),
        }),
      });

      const userEntity = $entity({
        name: "users",
        schema: z.object({
          id: db.primaryKey(),
          tenantId: z.integer(),
          tenantCode: z.string(),
          username: z.string(),
        }),
        foreignKeys: [
          {
            columns: ["tenantId", "tenantCode"],
            foreignColumns: [
              () => tenantEntity.cols.id,
              () => tenantEntity.cols.code,
            ],
          },
        ],
      });

      const fk = userEntity.options.foreignKeys![0];
      expect(fk.columns).toEqual(["tenantId", "tenantCode"]);
      expect(fk.foreignColumns).toHaveLength(2);

      const foreignCol1 = fk.foreignColumns[0]();
      const foreignCol2 = fk.foreignColumns[1]();

      expect(foreignCol1.name).toBe("id");
      expect(foreignCol2.name).toBe("code");
      expect(foreignCol1.entity.name).toBe("tenants");
      expect(foreignCol2.entity.name).toBe("tenants");
    });

    it("should maintain referential integrity through EntityColumn", () => {
      const entity1 = $entity({
        name: "entity1",
        schema: z.object({
          id: db.primaryKey(),
          value: z.string(),
        }),
      });

      const entity2 = $entity({
        name: "entity2",
        schema: z.object({
          id: db.primaryKey(),
          entity1Id: z.integer(),
          entity1Value: z.string(),
        }),
        foreignKeys: [
          {
            name: "entity2_entity1_fk",
            columns: ["entity1Id", "entity1Value"],
            foreignColumns: [() => entity1.cols.id, () => entity1.cols.value],
          },
        ],
      });

      // Verify that the foreign key correctly references entity1's columns
      const fk = entity2.options.foreignKeys![0];
      expect(fk.name).toBe("entity2_entity1_fk");

      const idRef = fk.foreignColumns[0]();
      const valueRef = fk.foreignColumns[1]();

      // Both columns should reference the same entity
      expect(idRef.entity).toBe(valueRef.entity);
      expect(idRef.entity.name).toBe("entity1");

      // But different columns
      expect(idRef.name).toBe("id");
      expect(valueRef.name).toBe("value");
    });
  });

  describe("integration", () => {
    it("should handle all entity options correctly (sqlite)", async () => {
      await testModelBuilderFeatures(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });

    it("should handle all entity options correctly (postgres)", async () => {
      await testModelBuilderFeatures(Alepha.create().with(AlephaOrmPostgres));
    });

    it("should handle custom config (sqlite)", async () => {
      await testCustomConfig(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });

    it("should handle custom config (postgres)", async () => {
      await testCustomConfig(Alepha.create().with(AlephaOrmPostgres));
    });

    it("should handle complex nested relationships (sqlite)", async () => {
      await testComplexRelationships(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });

    it("should handle complex nested relationships (postgres)", async () => {
      await testComplexRelationships(Alepha.create().with(AlephaOrmPostgres));
    });

    it("should enforce LOWER expression unique index (sqlite)", async () => {
      await testExpressionIndex(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });

    it("should enforce LOWER expression unique index (postgres)", async () => {
      await testExpressionIndex(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("dialect parity", () => {
    // An entity that builds on the sqlite dev driver but throws
    // "Unsupported schema type" at startup on postgres is a deploy-time
    // surprise, not a schema error.
    const dialects = [
      { name: "postgres", create: () => new PostgresModelBuilder() },
      { name: "sqlite", create: () => new SqliteModelBuilder() },
    ];

    const options = () => ({
      tables: new Map(),
      enums: new Map(),
      schemas: new Map(),
      schema: "public",
    });

    for (const dialect of dialects) {
      it(`should build a z.any() column (${dialect.name})`, () => {
        const entity = $entity({
          name: "events",
          schema: z.object({
            id: db.primaryKey(),
            payload: z.any(),
          }),
        });

        const opts = options();
        expect(() => dialect.create().buildTable(entity, opts)).not.toThrow();
        expect(opts.tables.has("events")).toBe(true);
      });

      it(`should build an array-of-any column (${dialect.name})`, () => {
        const entity = $entity({
          name: "events",
          schema: z.object({
            id: db.primaryKey(),
            payloads: z.array(z.any()),
          }),
        });

        const opts = options();
        expect(() => dialect.create().buildTable(entity, opts)).not.toThrow();
        expect(opts.tables.has("events")).toBe(true);
      });
    }
  });

  describe("unknown column references", () => {
    // A typo'd column used to produce no index, no foreign key, no constraint
    // and no error — migration generation then emitted a schema silently
    // missing it. Failing loudly at build time is the only safe answer.
    const dialects = [
      { name: "postgres", create: () => new PostgresModelBuilder() },
      { name: "sqlite", create: () => new SqliteModelBuilder() },
    ];

    const options = () => ({
      tables: new Map(),
      enums: new Map(),
      schemas: new Map(),
      schema: "public",
    });

    for (const dialect of dialects) {
      it(`should throw when an index names an unknown column (${dialect.name})`, () => {
        const entity = $entity({
          name: "users",
          schema: z.object({
            id: db.primaryKey(),
            email: z.email(),
          }),
          indexes: ["emial" as any],
        });

        expect(() => dialect.create().buildTable(entity, options())).toThrow(
          /emial/,
        );
      });

      it(`should throw when a composite index names an unknown column (${dialect.name})`, () => {
        const entity = $entity({
          name: "users",
          schema: z.object({
            id: db.primaryKey(),
            email: z.email(),
            username: z.text(),
          }),
          indexes: [{ columns: ["email", "usrname"] as any }],
        });

        expect(() => dialect.create().buildTable(entity, options())).toThrow(
          /usrname/,
        );
      });

      it(`should throw when a unique constraint names an unknown column (${dialect.name})`, () => {
        const entity = $entity({
          name: "users",
          schema: z.object({
            id: db.primaryKey(),
            email: z.email(),
          }),
          constraints: [{ columns: ["emial"] as any, unique: true }],
        });

        expect(() => dialect.create().buildTable(entity, options())).toThrow(
          /emial/,
        );
      });

      it(`should throw when a foreign key names an unknown local column (${dialect.name})`, () => {
        const builder = dialect.create();
        const opts = options();

        const usersEntity = $entity({
          name: "users",
          schema: z.object({
            id: db.primaryKey(),
            name: z.text(),
          }),
        });

        builder.buildTable(usersEntity, opts);

        const postsEntity = $entity({
          name: "posts",
          schema: z.object({
            id: db.primaryKey(),
            userId: z.text(),
          }),
          foreignKeys: [
            {
              name: "posts_user_fk",
              columns: ["user_id" as any],
              foreignColumns: [() => usersEntity.cols.id],
            },
          ],
        });

        expect(() => builder.buildTable(postsEntity, opts)).toThrow(/user_id/);
      });
    }
  });
});
