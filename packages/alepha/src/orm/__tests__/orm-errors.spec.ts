import { Alepha, t } from "alepha";
import { describe, it } from "vitest";
import {
  $entity,
  $repository,
  DatabaseProvider,
  DbColumnNotFoundError,
  DbConflictError,
  DbConnectionError,
  DbDeadlockError,
  DbForeignKeyError,
  DbNotNullError,
  DbTableNotFoundError,
  db,
  sql,
} from "../index.ts";
import {
  NodeSqliteProvider,
  nodeSqliteOptions,
} from "../providers/drivers/NodeSqliteProvider.ts";

/**
 * Database Error Tests
 *
 * This test suite validates that the ORM produces user-friendly error messages
 * for common database constraint violations:
 * - DbConflictError: unique constraint violations (duplicate key)
 * - DbForeignKeyError: foreign key constraint violations (referenced entity)
 *
 * Both PostgreSQL and SQLite are tested.
 */
describe("Database Error Tests", () => {
  // Parent entity (referenced by child)
  const parents = $entity({
    name: "error_test_parents",
    schema: t.object({
      id: db.primaryKey(),
      name: t.text(),
      email: t.text(),
    }),
    indexes: [{ column: "email", unique: true }],
  });

  // Child entity (references parent) - using RESTRICT (no cascade) to test FK errors
  const children = $entity({
    name: "error_test_children",
    schema: t.object({
      id: db.primaryKey(),
      parentId: t.integer(), // Plain integer, no db.ref() to avoid cascade
      name: t.text(),
    }),
    foreignKeys: [
      {
        columns: ["parentId"],
        foreignColumns: [() => parents.cols.id],
      },
    ],
  });

  // Entity with required fields for NOT NULL tests
  const requiredFields = $entity({
    name: "error_test_required",
    schema: t.object({
      id: db.primaryKey(),
      requiredName: t.text(), // NOT NULL by default
      optionalNote: t.optional(t.text()), // Nullable
    }),
  });

  class App {
    parents = $repository(parents);
    children = $repository(children);
    required = $repository(requiredFields);
  }

  describe("PostgreSQL", () => {
    describe("DbConflictError", () => {
      it("should throw DbConflictError on unique constraint violation", async ({
        expect,
      }) => {
        const alepha = Alepha.create();
        const app = alepha.inject(App);
        await alepha.start();

        // Create first entity
        await app.parents.create({
          name: "Alice",
          email: "alice@example.com",
        });

        // Try to create duplicate
        try {
          await app.parents.create({
            name: "Alice Clone",
            email: "alice@example.com", // Same email - should conflict
          });
          expect.fail("Should have thrown DbConflictError");
        } catch (error) {
          expect(error).toBeInstanceOf(DbConflictError);
          expect((error as DbConflictError).status).toBe(409);
          expect((error as DbConflictError).name).toBe("DbConflictError");
        }
      });

      it("should throw DbConflictError on update causing unique violation", async ({
        expect,
      }) => {
        const alepha = Alepha.create();
        const app = alepha.inject(App);
        await alepha.start();

        // Create two entities
        const alice = await app.parents.create({
          name: "Alice",
          email: "alice@example.com",
        });

        await app.parents.create({
          name: "Bob",
          email: "bob@example.com",
        });

        // Try to update Alice's email to Bob's email
        try {
          await app.parents.updateById(alice.id, {
            email: "bob@example.com",
          });
          expect.fail("Should have thrown DbConflictError");
        } catch (error) {
          expect(error).toBeInstanceOf(DbConflictError);
          expect((error as DbConflictError).status).toBe(409);
        }
      });
    });

    describe("DbForeignKeyError", () => {
      it("should throw DbForeignKeyError when deleting referenced entity", async ({
        expect,
      }) => {
        const alepha = Alepha.create();
        const app = alepha.inject(App);
        await alepha.start();

        // Create parent
        const parent = await app.parents.create({
          name: "Parent",
          email: "parent@example.com",
        });

        // Create child referencing parent
        await app.children.create({
          parentId: parent.id,
          name: "Child",
        });

        // Try to delete parent (should fail due to FK constraint)
        try {
          await app.parents.deleteById(parent.id);
          expect.fail("Should have thrown DbForeignKeyError");
        } catch (error) {
          expect(error).toBeInstanceOf(DbForeignKeyError);
          expect((error as DbForeignKeyError).status).toBe(409);
          expect((error as DbForeignKeyError).name).toBe("DbForeignKeyError");
          expect((error as DbForeignKeyError).message).toContain(
            "Cannot delete",
          );
          expect((error as DbForeignKeyError).message).toContain(
            "error_test_parents",
          );
          // PostgreSQL provides the referencing table name
          expect((error as DbForeignKeyError).referencingTable).toBe(
            "error_test_children",
          );
        }
      });

      it("should include constraint name in DbForeignKeyError", async ({
        expect,
      }) => {
        const alepha = Alepha.create();
        const app = alepha.inject(App);
        await alepha.start();

        const parent = await app.parents.create({
          name: "Parent2",
          email: "parent2@example.com",
        });

        await app.children.create({
          parentId: parent.id,
          name: "Child2",
        });

        try {
          await app.parents.deleteById(parent.id);
          expect.fail("Should have thrown DbForeignKeyError");
        } catch (error) {
          expect(error).toBeInstanceOf(DbForeignKeyError);
          // PostgreSQL provides the constraint name
          expect((error as DbForeignKeyError).constraintName).toBeDefined();
          expect((error as DbForeignKeyError).constraintName).toContain(
            "parent_id",
          );
        }
      });

      it("should allow delete after removing referencing entities", async ({
        expect,
      }) => {
        const alepha = Alepha.create();
        const app = alepha.inject(App);
        await alepha.start();

        const parent = await app.parents.create({
          name: "Parent3",
          email: "parent3@example.com",
        });

        const child = await app.children.create({
          parentId: parent.id,
          name: "Child3",
        });

        // Delete child first
        await app.children.deleteById(child.id);

        // Now parent can be deleted
        const deleted = await app.parents.deleteById(parent.id);
        expect(deleted).toContain(parent.id);
      });
    });

    describe("DbNotNullError", () => {
      it("should throw DbNotNullError when inserting null into required field via raw SQL", async ({
        expect,
      }) => {
        const alepha = Alepha.create();
        const app = alepha.inject(App);
        await alepha.start();

        // Use raw SQL to bypass ORM validation and trigger actual NOT NULL constraint
        try {
          await app.required.query(
            (t) =>
              sql`INSERT INTO ${t} (required_name) VALUES (${sql.raw("NULL")})`,
          );
          expect.fail("Should have thrown DbNotNullError");
        } catch (error) {
          expect(error).toBeInstanceOf(DbNotNullError);
          expect((error as DbNotNullError).status).toBe(400);
          expect((error as DbNotNullError).name).toBe("DbNotNullError");
          expect((error as DbNotNullError).column).toBe("required_name");
          expect((error as DbNotNullError).message).toContain("cannot be null");
        }
      });
    });

    describe("DbTableNotFoundError", () => {
      it("should throw DbTableNotFoundError for non-existent table", async ({
        expect,
      }) => {
        const alepha = Alepha.create();
        const app = alepha.inject(App);
        await alepha.start();

        try {
          await app.parents.query(
            () => sql`SELECT * FROM non_existent_table_xyz`,
          );
          expect.fail("Should have thrown DbTableNotFoundError");
        } catch (error) {
          expect(error).toBeInstanceOf(DbTableNotFoundError);
          expect((error as DbTableNotFoundError).status).toBe(500);
          expect((error as DbTableNotFoundError).table).toBe(
            "non_existent_table_xyz",
          );
          expect((error as DbTableNotFoundError).message).toContain(
            "does not exist",
          );
        }
      });
    });

    describe("DbColumnNotFoundError", () => {
      it("should throw DbColumnNotFoundError for non-existent column", async ({
        expect,
      }) => {
        const alepha = Alepha.create();
        const app = alepha.inject(App);
        await alepha.start();

        try {
          await app.parents.query(
            (t) => sql`SELECT ${sql.raw("non_existent_column_xyz")} FROM ${t}`,
          );
          expect.fail("Should have thrown DbColumnNotFoundError");
        } catch (error) {
          expect(error).toBeInstanceOf(DbColumnNotFoundError);
          expect((error as DbColumnNotFoundError).status).toBe(500);
          expect((error as DbColumnNotFoundError).column).toBe(
            "non_existent_column_xyz",
          );
        }
      });
    });
  });

  describe("SQLite", () => {
    describe("DbConflictError", () => {
      it("should throw DbConflictError on unique constraint violation", async ({
        expect,
      }) => {
        const alepha = Alepha.create().with({
          provide: DatabaseProvider,
          use: NodeSqliteProvider,
        });

        alepha.store.mut(nodeSqliteOptions, (old) => ({
          ...old,
          path: "sqlite://:memory:",
        }));

        const app = alepha.inject(App);
        await alepha.start();

        // Create first entity
        await app.parents.create({
          name: "SQLite Alice",
          email: "sqlite_alice@example.com",
        });

        // Try to create duplicate
        try {
          await app.parents.create({
            name: "SQLite Alice Clone",
            email: "sqlite_alice@example.com",
          });
          expect.fail("Should have thrown DbConflictError");
        } catch (error) {
          expect(error).toBeInstanceOf(DbConflictError);
          expect((error as DbConflictError).status).toBe(409);
        }
      });
    });

    describe("DbForeignKeyError", () => {
      it("should throw DbForeignKeyError when deleting referenced entity", async ({
        expect,
      }) => {
        const alepha = Alepha.create().with({
          provide: DatabaseProvider,
          use: NodeSqliteProvider,
        });

        alepha.store.mut(nodeSqliteOptions, (old) => ({
          ...old,
          path: "sqlite://:memory:",
        }));

        const app = alepha.inject(App);
        await alepha.start();

        // Create parent
        const parent = await app.parents.create({
          name: "SQLite Parent",
          email: "sqlite_parent@example.com",
        });

        // Create child referencing parent
        await app.children.create({
          parentId: parent.id,
          name: "SQLite Child",
        });

        // Try to delete parent (should fail due to FK constraint)
        try {
          await app.parents.deleteById(parent.id);
          expect.fail("Should have thrown DbForeignKeyError");
        } catch (error) {
          expect(error).toBeInstanceOf(DbForeignKeyError);
          expect((error as DbForeignKeyError).status).toBe(409);
          expect((error as DbForeignKeyError).name).toBe("DbForeignKeyError");
          expect((error as DbForeignKeyError).message).toContain(
            "Cannot delete",
          );
          // SQLite doesn't provide the referencing table name in error
          expect((error as DbForeignKeyError).message).toContain(
            "error_test_parents",
          );
        }
      });

      it("should have generic message for SQLite (no table name available)", async ({
        expect,
      }) => {
        const alepha = Alepha.create().with({
          provide: DatabaseProvider,
          use: NodeSqliteProvider,
        });

        alepha.store.mut(nodeSqliteOptions, (old) => ({
          ...old,
          path: "sqlite://:memory:",
        }));

        const app = alepha.inject(App);
        await alepha.start();

        const parent = await app.parents.create({
          name: "SQLite Parent2",
          email: "sqlite_parent2@example.com",
        });

        await app.children.create({
          parentId: parent.id,
          name: "SQLite Child2",
        });

        try {
          await app.parents.deleteById(parent.id);
          expect.fail("Should have thrown DbForeignKeyError");
        } catch (error) {
          expect(error).toBeInstanceOf(DbForeignKeyError);
          // SQLite doesn't provide constraint name or referencing table
          expect((error as DbForeignKeyError).referencingTable).toBeUndefined();
          expect((error as DbForeignKeyError).constraintName).toBeUndefined();
          // Message should mention "another entity" since table name is unknown
          expect((error as DbForeignKeyError).message).toContain(
            "another entity",
          );
        }
      });
    });

    describe("DbNotNullError", () => {
      it("should throw DbNotNullError when inserting null into required field via raw SQL", async ({
        expect,
      }) => {
        const alepha = Alepha.create().with({
          provide: DatabaseProvider,
          use: NodeSqliteProvider,
        });

        alepha.store.mut(nodeSqliteOptions, (old) => ({
          ...old,
          path: "sqlite://:memory:",
        }));

        const app = alepha.inject(App);
        await alepha.start();

        // Use raw SQL to bypass ORM validation and trigger actual NOT NULL constraint
        try {
          await app.required.query(
            (t) =>
              sql`INSERT INTO ${t} (required_name) VALUES (${sql.raw("NULL")})`,
          );
          expect.fail("Should have thrown DbNotNullError");
        } catch (error) {
          expect(error).toBeInstanceOf(DbNotNullError);
          expect((error as DbNotNullError).status).toBe(400);
          // SQLite includes table.column format
          expect((error as DbNotNullError).column).toBe("required_name");
          expect((error as DbNotNullError).message).toContain("cannot be null");
        }
      });
    });

    describe("DbTableNotFoundError", () => {
      it("should throw DbTableNotFoundError for non-existent table", async ({
        expect,
      }) => {
        const alepha = Alepha.create().with({
          provide: DatabaseProvider,
          use: NodeSqliteProvider,
        });

        alepha.store.mut(nodeSqliteOptions, (old) => ({
          ...old,
          path: "sqlite://:memory:",
        }));

        const app = alepha.inject(App);
        await alepha.start();

        try {
          await app.parents.query(
            () => sql`SELECT * FROM non_existent_table_xyz`,
          );
          expect.fail("Should have thrown DbTableNotFoundError");
        } catch (error) {
          expect(error).toBeInstanceOf(DbTableNotFoundError);
          expect((error as DbTableNotFoundError).table).toBe(
            "non_existent_table_xyz",
          );
        }
      });
    });

    describe("DbColumnNotFoundError", () => {
      it("should throw DbColumnNotFoundError for non-existent column", async ({
        expect,
      }) => {
        const alepha = Alepha.create().with({
          provide: DatabaseProvider,
          use: NodeSqliteProvider,
        });

        alepha.store.mut(nodeSqliteOptions, (old) => ({
          ...old,
          path: "sqlite://:memory:",
        }));

        const app = alepha.inject(App);
        await alepha.start();

        try {
          await app.parents.query(
            (t) => sql`SELECT ${sql.raw("non_existent_column_xyz")} FROM ${t}`,
          );
          expect.fail("Should have thrown DbColumnNotFoundError");
        } catch (error) {
          expect(error).toBeInstanceOf(DbColumnNotFoundError);
          expect((error as DbColumnNotFoundError).column).toBe(
            "non_existent_column_xyz",
          );
        }
      });
    });
  });

  describe("Error Properties", () => {
    it("DbConflictError should have correct properties", async ({ expect }) => {
      const error = new DbConflictError("Test conflict");
      expect(error.name).toBe("DbConflictError");
      expect(error.status).toBe(409);
      expect(error.message).toBe("Test conflict");
    });

    it("DbForeignKeyError should have correct properties", async ({
      expect,
    }) => {
      const error = new DbForeignKeyError("Test FK error", undefined, {
        referencingTable: "child_table",
        constraintName: "child_parent_id_fk",
      });
      expect(error.name).toBe("DbForeignKeyError");
      expect(error.status).toBe(409);
      expect(error.message).toBe("Test FK error");
      expect(error.referencingTable).toBe("child_table");
      expect(error.constraintName).toBe("child_parent_id_fk");
    });

    it("DbForeignKeyError.fromDatabaseError should parse PostgreSQL error", async ({
      expect,
    }) => {
      const dbError = new Error(
        'update or delete on table "query_item" violates foreign key constraint "reporting_alert_query_id_fk" on table "reporting_alert"',
      );

      const error = DbForeignKeyError.fromDatabaseError(dbError, "query_item");

      expect(error.message).toBe(
        "Cannot delete query_item: it is referenced by reporting_alert",
      );
      expect(error.referencingTable).toBe("reporting_alert");
      expect(error.constraintName).toBe("reporting_alert_query_id_fk");
    });

    it("DbForeignKeyError.fromDatabaseError should handle SQLite error", async ({
      expect,
    }) => {
      const sqliteError = new Error("FOREIGN KEY constraint failed");

      const error = DbForeignKeyError.fromDatabaseError(
        sqliteError,
        "parent_table",
      );

      expect(error.message).toBe(
        "Cannot delete parent_table: it is referenced by another entity",
      );
      expect(error.referencingTable).toBeUndefined();
      expect(error.constraintName).toBeUndefined();
    });

    // DbNotNullError tests
    it("DbNotNullError should have correct properties", async ({ expect }) => {
      const error = new DbNotNullError("Test not null", undefined, {
        column: "email",
        table: "users",
      });
      expect(error.name).toBe("DbNotNullError");
      expect(error.status).toBe(400);
      expect(error.column).toBe("email");
      expect(error.table).toBe("users");
    });

    it("DbNotNullError.fromDatabaseError should parse PostgreSQL error", async ({
      expect,
    }) => {
      const dbError = new Error(
        'null value in column "email" of relation "users" violates not-null constraint',
      );

      const error = DbNotNullError.fromDatabaseError(dbError, "users");

      expect(error.message).toBe("Column 'email' in 'users' cannot be null");
      expect(error.column).toBe("email");
      expect(error.table).toBe("users");
    });

    it("DbNotNullError.fromDatabaseError should parse SQLite error", async ({
      expect,
    }) => {
      const sqliteError = new Error("NOT NULL constraint failed: users.email");

      const error = DbNotNullError.fromDatabaseError(sqliteError, "users");

      expect(error.message).toBe("Column 'email' in 'users' cannot be null");
      expect(error.column).toBe("email");
      expect(error.table).toBe("users");
    });

    // DbDeadlockError tests
    it("DbDeadlockError should have correct properties", async ({ expect }) => {
      const error = new DbDeadlockError("Deadlock detected");
      expect(error.name).toBe("DbDeadlockError");
      expect(error.status).toBe(409);
      expect(error.retryable).toBe(true);
    });

    it("DbDeadlockError.fromDatabaseError should create error", async ({
      expect,
    }) => {
      const dbError = new Error("deadlock detected");

      const error = DbDeadlockError.fromDatabaseError(dbError);

      expect(error.message).toContain("deadlock");
      expect(error.retryable).toBe(true);
    });

    // DbConnectionError tests
    it("DbConnectionError should have correct properties", async ({
      expect,
    }) => {
      const error = new DbConnectionError("Connection failed", undefined, {
        errorType: "refused",
        retryable: true,
      });
      expect(error.name).toBe("DbConnectionError");
      expect(error.status).toBe(503);
      expect(error.errorType).toBe("refused");
      expect(error.retryable).toBe(true);
    });

    it("DbConnectionError.fromDatabaseError should detect connection refused", async ({
      expect,
    }) => {
      const error = DbConnectionError.fromDatabaseError(
        new Error("connection refused"),
      );
      expect(error.errorType).toBe("refused");
      expect(error.retryable).toBe(true);
    });

    it("DbConnectionError.fromDatabaseError should detect timeout", async ({
      expect,
    }) => {
      const error = DbConnectionError.fromDatabaseError(
        new Error("connection timed out"),
      );
      expect(error.errorType).toBe("timeout");
      expect(error.retryable).toBe(true);
    });

    it("DbConnectionError.fromDatabaseError should detect auth failure", async ({
      expect,
    }) => {
      const error = DbConnectionError.fromDatabaseError(
        new Error("password authentication failed for user"),
      );
      expect(error.errorType).toBe("auth");
      expect(error.retryable).toBe(false);
    });

    it("DbConnectionError.fromDatabaseError should detect SQLite locked", async ({
      expect,
    }) => {
      const error = DbConnectionError.fromDatabaseError(
        new Error("database is locked"),
      );
      expect(error.errorType).toBe("locked");
      expect(error.retryable).toBe(true);
    });

    // DbTableNotFoundError tests
    it("DbTableNotFoundError should have correct properties", async ({
      expect,
    }) => {
      const error = new DbTableNotFoundError("Table not found", undefined, {
        table: "users",
      });
      expect(error.name).toBe("DbTableNotFoundError");
      expect(error.status).toBe(500);
      expect(error.table).toBe("users");
    });

    it("DbTableNotFoundError.fromDatabaseError should parse PostgreSQL error", async ({
      expect,
    }) => {
      const dbError = new Error('relation "users" does not exist');

      const error = DbTableNotFoundError.fromDatabaseError(dbError);

      expect(error.table).toBe("users");
      expect(error.message).toContain("does not exist");
    });

    it("DbTableNotFoundError.fromDatabaseError should parse SQLite error", async ({
      expect,
    }) => {
      const sqliteError = new Error("no such table: users");

      const error = DbTableNotFoundError.fromDatabaseError(sqliteError);

      expect(error.table).toBe("users");
      expect(error.message).toContain("does not exist");
    });

    // DbColumnNotFoundError tests
    it("DbColumnNotFoundError should have correct properties", async ({
      expect,
    }) => {
      const error = new DbColumnNotFoundError("Column not found", undefined, {
        column: "email",
        table: "users",
      });
      expect(error.name).toBe("DbColumnNotFoundError");
      expect(error.status).toBe(500);
      expect(error.column).toBe("email");
      expect(error.table).toBe("users");
    });

    it("DbColumnNotFoundError.fromDatabaseError should parse PostgreSQL error", async ({
      expect,
    }) => {
      const dbError = new Error('column "email" does not exist');

      const error = DbColumnNotFoundError.fromDatabaseError(dbError);

      expect(error.column).toBe("email");
    });

    it("DbColumnNotFoundError.fromDatabaseError should parse PostgreSQL error with table", async ({
      expect,
    }) => {
      const dbError = new Error(
        'column "email" of relation "users" does not exist',
      );

      const error = DbColumnNotFoundError.fromDatabaseError(dbError);

      expect(error.column).toBe("email");
      expect(error.table).toBe("users");
    });

    it("DbColumnNotFoundError.fromDatabaseError should parse SQLite error", async ({
      expect,
    }) => {
      const sqliteError = new Error("no such column: email");

      const error = DbColumnNotFoundError.fromDatabaseError(sqliteError);

      expect(error.column).toBe("email");
    });

    it("DbColumnNotFoundError.fromDatabaseError should parse SQLite error with table", async ({
      expect,
    }) => {
      const sqliteError = new Error("no such column: users.email");

      const error = DbColumnNotFoundError.fromDatabaseError(sqliteError);

      expect(error.column).toBe("email");
      expect(error.table).toBe("users");
    });
  });
});
