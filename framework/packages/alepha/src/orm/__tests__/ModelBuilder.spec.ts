import { Alepha, z } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { sql } from "drizzle-orm";
import { getTableConfig as getPgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as getSqliteTableConfig } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it } from "vitest";

import { $entity } from "../core/primitives/$entity.ts";
import { db } from "../core/providers/DatabaseTypeProvider.ts";
import { PostgresModelBuilder } from "../core/services/PostgresModelBuilder.ts";
import { SqliteModelBuilder } from "../core/services/SqliteModelBuilder.ts";
import {
  testComplexRelationships,
  testExpressionIndex,
  testModelBuilderFeatures,
} from "./ModelBuilder-tests.ts";

/**
 * What a builder put on the drizzle table: the columns, indexes, foreign
 * keys, checks and unique constraints, by their database names. Both
 * dialects answer the same shape, so one set of expectations reads both.
 */
const describeTable = (dialect: "postgres" | "sqlite", table: unknown) => {
  const config =
    dialect === "postgres"
      ? getPgTableConfig(table as never)
      : getSqliteTableConfig(table as never);
  const names = (columns: ReadonlyArray<unknown>) =>
    columns.map((column) => (column as { name?: string }).name ?? "<sql>");
  return {
    columns: Object.fromEntries(
      config.columns.map((column) => [column.name, column.getSQLType()]),
    ),
    indexes: config.indexes.map((index) => ({
      name: index.config.name,
      unique: index.config.unique ?? false,
      columns: names(index.config.columns),
    })),
    foreignKeys: config.foreignKeys.map((key) => ({
      name: key.getName(),
      columns: names(key.reference().columns),
      foreignColumns: names(key.reference().foreignColumns),
    })),
    checks: config.checks.map((check) => check.name),
    uniques: config.uniqueConstraints.map((unique) => ({
      name: unique.name,
      columns: names(unique.columns),
    })),
  };
};

class TestPostgresModelBuilder extends PostgresModelBuilder {
  public testToColumnName = this.toColumnName.bind(this);
}

describe("ModelBuilder", () => {
  const builders = [
    {
      dialect: "postgres",
      create: () => Alepha.create().inject(PostgresModelBuilder),
    },
    {
      dialect: "sqlite",
      create: () => Alepha.create().inject(SqliteModelBuilder),
    },
  ] as const;

  for (const { dialect, create } of builders) {
    describe(`${dialect} model builder`, () => {
      let builder: PostgresModelBuilder | SqliteModelBuilder;
      let options: {
        tables: Map<string, unknown>;
        enums: Map<string, unknown>;
        schemas: Map<string, unknown>;
        schema: string;
      };

      beforeEach(() => {
        builder = create();
        options = {
          tables: new Map(),
          enums: new Map(),
          schemas: new Map(),
          schema: "public",
        };
      });

      const built = (name: string) =>
        describeTable(dialect, options.tables.get(name));

      it("should build a basic table with snake_case columns", () => {
        const entity = $entity({
          name: "users",
          schema: z.object({
            id: db.primaryKey(z.integer()),
            firstName: z.text(),
            emailAddress: z.email(),
          }),
        });

        builder.buildTable(entity, options);

        expect(built("users")).toEqual({
          columns: {
            id: "integer",
            first_name: "text",
            email_address: "text",
          },
          indexes: [],
          foreignKeys: [],
          checks: [],
          uniques: [],
        });
      });

      it("should build table with single column indexes", () => {
        const entity = $entity({
          name: "users",
          schema: z.object({
            id: db.primaryKey(z.integer()),
            email: z.email(),
            firstName: z.text(),
          }),
          indexes: ["email", "firstName"],
        });

        builder.buildTable(entity, options);

        expect(built("users").indexes).toEqual([
          { name: "users_email_idx", unique: false, columns: ["email"] },
          {
            name: "users_first_name_idx",
            unique: false,
            columns: ["first_name"],
          },
        ]);
      });

      it("should build table with unique index", () => {
        const entity = $entity({
          name: "users",
          schema: z.object({
            id: db.primaryKey(z.integer()),
            email: z.email(),
            username: z.text(),
          }),
          indexes: [
            { column: "email", unique: true, name: "unique_email_idx" },
            { column: "username", unique: true },
          ],
        });

        builder.buildTable(entity, options);

        expect(built("users").indexes).toEqual([
          { name: "unique_email_idx", unique: true, columns: ["email"] },
          { name: "users_username_idx", unique: true, columns: ["username"] },
        ]);
      });

      it("should build table with composite index", () => {
        const entity = $entity({
          name: "posts",
          schema: z.object({
            id: db.primaryKey(z.integer()),
            userId: z.text(),
            createdAt: z.string().meta({ format: "date-time" }),
            title: z.text(),
          }),
          indexes: [
            { columns: ["userId", "createdAt"], name: "user_created_idx" },
          ],
        });

        builder.buildTable(entity, options);

        expect(built("posts").indexes).toEqual([
          {
            name: "user_created_idx",
            unique: false,
            columns: ["user_id", "created_at"],
          },
        ]);
      });

      it("should build table with unique composite index", () => {
        const entity = $entity({
          name: "user_roles",
          schema: z.object({
            id: db.primaryKey(z.integer()),
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

        expect(built("user_roles").indexes).toEqual([
          {
            name: "unique_user_role",
            unique: true,
            columns: ["user_id", "role_id"],
          },
        ]);
      });

      it("should build table with foreign keys", () => {
        const usersEntity = $entity({
          name: "users",
          schema: z.object({
            id: db.primaryKey(z.integer()),
            name: z.text(),
          }),
        });
        builder.buildTable(usersEntity, options);

        const postsEntity = $entity({
          name: "posts",
          schema: z.object({
            id: db.primaryKey(z.integer()),
            userId: z.integer(),
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

        expect(built("posts").foreignKeys).toEqual([
          {
            name: "posts_user_fk",
            columns: ["user_id"],
            foreignColumns: ["id"],
          },
        ]);
      });

      it("should build table with unique constraint", () => {
        const entity = $entity({
          name: "users",
          schema: z.object({
            id: db.primaryKey(z.integer()),
            email: z.email(),
            username: z.text(),
          }),
          constraints: [
            { columns: ["email"], unique: true, name: "unique_user_email" },
          ],
        });

        builder.buildTable(entity, options);

        expect(built("users").uniques).toEqual([
          { name: "unique_user_email", columns: ["email"] },
        ]);
      });

      it("should build table with check constraint", () => {
        const entity = $entity({
          name: "users",
          schema: z.object({
            id: db.primaryKey(z.integer()),
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

        expect(built("users").checks).toEqual(["valid_age_range"]);
        expect(built("users").uniques).toEqual([]);
      });

      it("should build table with composite unique constraint", () => {
        const entity = $entity({
          name: "user_settings",
          schema: z.object({
            id: db.primaryKey(z.integer()),
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

        expect(built("user_settings").uniques).toEqual([
          { name: "unique_user_setting", columns: ["user_id", "setting_key"] },
        ]);
      });

      it("should build table with all options combined", () => {
        const rolesEntity = $entity({
          name: "roles",
          schema: z.object({
            id: db.primaryKey(z.integer()),
            name: z.text(),
          }),
        });
        builder.buildTable(rolesEntity, options);

        const entity = $entity({
          name: "users",
          schema: z.object({
            id: db.primaryKey(z.integer()),
            email: z.email(),
            username: z.text(),
            age: z.integer(),
            roleId: z.integer(),
            createdAt: z.string().meta({ format: "date-time" }),
          }),
          indexes: [
            "email",
            { column: "username", unique: true },
            { columns: ["roleId", "createdAt"], name: "role_created_idx" },
          ],
          foreignKeys: [
            {
              name: "users_role_fk",
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
        });

        builder.buildTable(entity, options);

        const table = built("users");
        expect(table.indexes).toEqual([
          { name: "users_email_idx", unique: false, columns: ["email"] },
          { name: "users_username_idx", unique: true, columns: ["username"] },
          {
            name: "role_created_idx",
            unique: false,
            columns: ["role_id", "created_at"],
          },
        ]);
        expect(table.foreignKeys).toEqual([
          {
            name: "users_role_fk",
            columns: ["role_id"],
            foreignColumns: ["id"],
          },
        ]);
        expect(table.checks).toEqual(["adult_users_only"]);
        expect(table.uniques).toEqual([
          { name: "unique_email_username", columns: ["email", "username"] },
        ]);
      });

      it("should build a plain bigint column in the dialect's own type", () => {
        const entity = $entity({
          name: "counters",
          schema: z.object({
            id: db.primaryKey(z.integer()),
            totalViews: z.bigint(),
          }),
        });

        builder.buildTable(entity, options);

        expect(built("counters").columns.total_views).toBe(
          dialect === "postgres" ? "bigint" : "text",
        );
      });

      it("should use the snake_case column name for an identity primary key", () => {
        const entity = $entity({
          name: "events",
          schema: z.object({
            eventId: db.identityPrimaryKey(),
            name: z.text(),
          }),
        });

        builder.buildTable(entity, options);

        expect(Object.keys(built("events").columns)).toEqual([
          "event_id",
          "name",
        ]);
      });

      it("should build table with expression-based index", () => {
        const entity = $entity({
          name: "users",
          schema: z.object({
            id: db.primaryKey(z.integer()),
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

        expect(built("users").indexes).toEqual([
          {
            name: "users_realm_username_lower_idx",
            unique: true,
            columns: ["realm", "<sql>"],
          },
        ]);
      });

      it("should build table with expression-only index", () => {
        const entity = $entity({
          name: "users",
          schema: z.object({
            id: db.primaryKey(z.integer()),
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

        expect(built("users").indexes).toEqual([
          { name: "users_email_lower_idx", unique: true, columns: ["<sql>"] },
        ]);
      });

      it("should build an array-of-enum column", () => {
        // On SQLite an enum array element used to fall through to the
        // "Unsupported schema for field" throw. It is stored as JSON text
        // there, like an array-of-string column.
        const entity = $entity({
          name: "products",
          schema: z.object({
            id: db.primaryKey(z.integer()),
            channels: z.array(z.enum(["desk", "portal", "mobile"])),
          }),
        });

        builder.buildTable(entity, options);

        expect(Object.keys(built("products").columns)).toEqual([
          "id",
          "channels",
        ]);
        if (dialect === "sqlite") {
          expect(built("products").columns.channels).toBe("text");
        }
      });

      it("should not recreate table if it already exists", () => {
        const entity = $entity({
          name: "users",
          schema: z.object({
            id: db.primaryKey(z.integer()),
            name: z.text(),
          }),
        });

        builder.buildTable(entity, options);
        const firstTable = options.tables.get("users");

        builder.buildTable(entity, options);
        const secondTable = options.tables.get("users");

        expect(firstTable).toBeDefined();
        expect(firstTable).toBe(secondTable);
      });
    });
  }

  describe("SqliteModelBuilder sequences", () => {
    it("should throw error for sequences", () => {
      const builder = Alepha.create().inject(SqliteModelBuilder);
      expect(() => {
        builder.buildSequence({ name: "test_seq", options: {} } as any, {
          sequences: new Map(),
          schema: "public",
        });
      }).toThrow("SQLite does not support sequences");
    });
  });

  describe("toColumnName", () => {
    it("should convert camelCase to snake_case correctly", () => {
      const builder = Alepha.create().inject(TestPostgresModelBuilder);

      expect(builder.testToColumnName("id")).toBe("id");
      expect(builder.testToColumnName("userId")).toBe("user_id");
      expect(builder.testToColumnName("firstName")).toBe("first_name");
      expect(builder.testToColumnName("emailAddress")).toBe("email_address");
      expect(builder.testToColumnName("createdAt")).toBe("created_at");
      expect(builder.testToColumnName("isActiveUser")).toBe("is_active_user");
    });
  });

  describe("integration", () => {
    it("should handle all entity options correctly (sqlite)", async () => {
      await testModelBuilderFeatures(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });

    it("should handle all entity options correctly (postgres)", async () => {
      await testModelBuilderFeatures(
        Alepha.create().with(AlephaOrmTestPostgres),
      );
    });

    it("should handle complex nested relationships (sqlite)", async () => {
      await testComplexRelationships(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });

    it("should handle complex nested relationships (postgres)", async () => {
      await testComplexRelationships(
        Alepha.create().with(AlephaOrmTestPostgres),
      );
    });

    it("should enforce LOWER expression unique index (sqlite)", async () => {
      await testExpressionIndex(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });

    it("should enforce LOWER expression unique index (postgres)", async () => {
      await testExpressionIndex(Alepha.create().with(AlephaOrmTestPostgres));
    });
  });

  describe("dialect parity", () => {
    // An entity that builds on the sqlite dev driver but throws
    // "Unsupported schema type" at startup on postgres is a deploy-time
    // surprise, not a schema error.
    const dialects = [
      {
        name: "postgres",
        create: () => Alepha.create().inject(PostgresModelBuilder),
      },
      {
        name: "sqlite",
        create: () => Alepha.create().inject(SqliteModelBuilder),
      },
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
            id: db.primaryKey(z.integer()),
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
            id: db.primaryKey(z.integer()),
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
    // and no error: migration generation then emitted a schema silently
    // missing it. Failing loudly at build time is the only safe answer.
    const dialects = [
      {
        name: "postgres",
        create: () => Alepha.create().inject(PostgresModelBuilder),
      },
      {
        name: "sqlite",
        create: () => Alepha.create().inject(SqliteModelBuilder),
      },
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
            id: db.primaryKey(z.integer()),
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
            id: db.primaryKey(z.integer()),
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
            id: db.primaryKey(z.integer()),
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
            id: db.primaryKey(z.integer()),
            name: z.text(),
          }),
        });

        builder.buildTable(usersEntity, opts);

        const postsEntity = $entity({
          name: "posts",
          schema: z.object({
            id: db.primaryKey(z.integer()),
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
