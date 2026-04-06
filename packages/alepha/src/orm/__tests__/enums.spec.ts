import { Alepha, t } from "alepha";
import { describe, expect, it } from "vitest";
import { $entity, $repository, DrizzleKitProvider, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

// Test 1: t.enum with mode: "text" (should map to TEXT column)
const textEnumEntity = $entity({
  name: "text_enum_test",
  schema: t.object({
    id: db.primaryKey(),
    status: t.enum(["pending", "active", "archived"], { mode: "text" }),
    role: t.enum(["user", "admin", "moderator"], { mode: "text" }),
  }),
});

// Test 2: t.enum without mode (should create real PG ENUM type)
const pgEnumEntity = $entity({
  name: "pg_enum_test",
  schema: t.object({
    id: db.primaryKey(),
    status: t.enum(["draft", "published", "deleted"]),
    priority: t.enum(["low", "medium", "high"]),
  }),
});

// Test 3: Mixed text and pg enum in the same table
const mixedEnumEntity = $entity({
  name: "mixed_enum_test",
  schema: t.object({
    id: db.primaryKey(),
    textStatus: t.enum(["open", "closed"], { mode: "text" }),
    pgStatus: t.enum(["new", "in_progress", "done"]),
  }),
});

// Test 4: Shared enum with custom name across two tables
const sharedEnumEntity1 = $entity({
  name: "shared_enum_test_1",
  schema: t.object({
    id: db.primaryKey(),
    status: t.enum(["enabled", "disabled"], { name: "shared_status_enum" }),
  }),
});

const sharedEnumEntity2 = $entity({
  name: "shared_enum_test_2",
  schema: t.object({
    id: db.primaryKey(),
    status: t.enum(["enabled", "disabled"], { name: "shared_status_enum" }),
  }),
});

// Test 5: Conflicting enum - same name but different values (should throw error)
const conflictEnumEntity1 = $entity({
  name: "conflict_enum_test_1",
  schema: t.object({
    id: db.primaryKey(),
    status: t.enum(["a", "b", "c"], { name: "conflict_status_enum" }),
  }),
});

const conflictEnumEntity2 = $entity({
  name: "conflict_enum_test_2",
  schema: t.object({
    id: db.primaryKey(),
    status: t.enum(["a", "b", "d"], { name: "conflict_status_enum" }), // Different value!
  }),
});

describe("enums - t.enum with mode: 'text' (TEXT column)", () => {
  it("should create TEXT columns for t.enum fields with mode: 'text'", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);

    class App {
      repository = $repository(textEnumEntity);
    }

    const app = alepha.inject(App);
    const drizzleKit = alepha.inject(DrizzleKitProvider);

    await alepha.start();

    // Check generated SQL
    const { statements: sql } = await drizzleKit.generateMigration(
      app.repository.provider,
    );

    expect(sql).toContainEqual(expect.stringContaining("CREATE TABLE"));
    expect(sql).toContainEqual(expect.stringContaining("text_enum_test"));
    // mode: "text" should map to TEXT, not a real ENUM type
    expect(sql.some((s) => s.includes('"status" text'))).toBe(true);
    expect(sql.some((s) => s.includes('"role" text'))).toBe(true);
  });

  it("should allow inserting and querying with text enum values", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);

    class App {
      repository = $repository(textEnumEntity);
    }

    const app = alepha.inject(App);
    await alepha.start();

    const created = await app.repository.create({
      status: "pending",
      role: "user",
    });

    expect(created.status).toBe("pending");
    expect(created.role).toBe("user");
    expect(created.id).toBeDefined();

    const found = await app.repository.findOne({ where: { id: created.id } });
    expect(found?.status).toBe("pending");
    expect(found?.role).toBe("user");
  });
});

describe("enums - t.enum (real PG ENUM type)", () => {
  it("should create real PostgreSQL ENUM types for t.enum fields", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);

    class App {
      repository = $repository(pgEnumEntity);
    }

    const app = alepha.inject(App);
    const drizzleKit = alepha.inject(DrizzleKitProvider);

    await alepha.start();

    // Check generated SQL
    const { statements: sql } = await drizzleKit.generateMigration(
      app.repository.provider,
    );

    expect(sql).toContainEqual(expect.stringContaining("CREATE TABLE"));
    expect(sql).toContainEqual(expect.stringContaining("pg_enum_test"));
    // t.enum without mode should create real ENUM types
    expect(
      sql.some((s) => s.includes("CREATE TYPE") || s.includes("DO $$ BEGIN")),
    ).toBe(true);
  });

  it("should allow inserting and querying with pg enum values", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);

    class App {
      repository = $repository(pgEnumEntity);
    }

    const app = alepha.inject(App);
    await alepha.start();

    const created = await app.repository.create({
      status: "draft",
      priority: "high",
    });

    expect(created.status).toBe("draft");
    expect(created.priority).toBe("high");
    expect(created.id).toBeDefined();

    const found = await app.repository.findOne({ where: { id: created.id } });
    expect(found?.status).toBe("draft");
    expect(found?.priority).toBe("high");
  });
});

describe("enums - mixed text and pg enum in same table", () => {
  it("should handle both TEXT and PG ENUM types in the same table", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);

    class App {
      repository = $repository(mixedEnumEntity);
    }

    const app = alepha.inject(App);
    const drizzleKit = alepha.inject(DrizzleKitProvider);

    await alepha.start();

    // Check generated SQL
    const { statements: sql } = await drizzleKit.generateMigration(
      app.repository.provider,
    );

    expect(sql).toContainEqual(expect.stringContaining("CREATE TABLE"));
    expect(sql).toContainEqual(expect.stringContaining("mixed_enum_test"));
    // textStatus should be TEXT
    expect(
      sql.some(
        (s) =>
          s.includes('"text_status" text') || s.includes('"textStatus" text'),
      ),
    ).toBe(true);
    // pgStatus should create an ENUM type
    expect(
      sql.some((s) => s.includes("CREATE TYPE") || s.includes("DO $$ BEGIN")),
    ).toBe(true);
  });

  it("should allow inserting and querying with mixed enum values", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);

    class App {
      repository = $repository(mixedEnumEntity);
    }

    const app = alepha.inject(App);
    await alepha.start();

    const created = await app.repository.create({
      textStatus: "open",
      pgStatus: "new",
    });

    expect(created.textStatus).toBe("open");
    expect(created.pgStatus).toBe("new");
    expect(created.id).toBeDefined();

    const found = await app.repository.findOne({ where: { id: created.id } });
    expect(found?.textStatus).toBe("open");
    expect(found?.pgStatus).toBe("new");
  });
});

describe("enums - shared enum with custom name across tables", () => {
  it("should reuse the same PG ENUM type across multiple tables", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);

    class App {
      repository1 = $repository(sharedEnumEntity1);
      repository2 = $repository(sharedEnumEntity2);
    }

    const app = alepha.inject(App);
    const drizzleKit = alepha.inject(DrizzleKitProvider);

    await alepha.start();

    // Check generated SQL
    const { statements: sql } = await drizzleKit.generateMigration(
      app.repository1.provider,
    );

    // Count how many times the shared_status_enum is created
    // It should only be created once, even though it's used in two tables
    const enumCreations = sql.filter(
      (s) =>
        s.includes("shared_status_enum") &&
        (s.includes("CREATE TYPE") || s.includes("DO $$ BEGIN")),
    );

    // Should only create the enum type once
    expect(enumCreations.length).toBeLessThanOrEqual(1);

    // Both tables should exist
    expect(sql.some((s) => s.includes("shared_enum_test_1"))).toBe(true);
    expect(sql.some((s) => s.includes("shared_enum_test_2"))).toBe(true);
  });

  it("should allow both tables to use the shared enum values", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);

    class App {
      repository1 = $repository(sharedEnumEntity1);
      repository2 = $repository(sharedEnumEntity2);
    }

    const app = alepha.inject(App);
    await alepha.start();

    const created1 = await app.repository1.create({
      status: "enabled",
    });

    const created2 = await app.repository2.create({
      status: "disabled",
    });

    expect(created1.status).toBe("enabled");
    expect(created2.status).toBe("disabled");

    const found1 = await app.repository1.findOne({
      where: { id: created1.id },
    });
    const found2 = await app.repository2.findOne({
      where: { id: created2.id },
    });

    expect(found1?.status).toBe("enabled");
    expect(found2?.status).toBe("disabled");
  });
});

describe("enums - conflict detection with different values", () => {
  it("should throw error when same enum name has different values", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);

    expect(() =>
      alepha.with(() => ({
        r1: $repository(conflictEnumEntity1),
        r2: $repository(conflictEnumEntity2),
      })),
    ).toThrow(/Enum name conflict/i);
  });
});
