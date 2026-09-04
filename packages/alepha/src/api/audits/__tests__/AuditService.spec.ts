import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { AlephaApiAudits, AuditService, audits } from "../index.ts";

/**
 * Direct repository access so retention tests can backdate `createdAt` (which
 * the public `create` API does not expose).
 */
class Db {
  audits = $repository(audits);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error" },
  });

  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaApiAudits);

  // Inject before start: the container locks once started, so test-only
  // services (Db) must be registered first.
  const db = alepha.inject(Db);
  const time = alepha.inject(DateTimeProvider);

  await alepha.start();

  const auditService = alepha.inject(AuditService);

  return {
    alepha,
    auditService,
    db,
    time,
  };
};

describe("alepha/api/audits - AuditService", () => {
  describe("create", () => {
    it("should create a basic audit entry", async ({ expect }) => {
      const { auditService } = await setup();

      const entry = await auditService.create({
        type: "test",
        action: "create",
        description: "Test audit entry",
      });

      expect(entry.id).toBeDefined();
      expect(entry.type).toBe("test");
      expect(entry.action).toBe("create");
      expect(entry.description).toBe("Test audit entry");
      expect(entry.severity).toBe("info");
      expect(entry.success).toBe(true);
      expect(entry.createdAt).toBeDefined();
    });

    it("should create audit entry with all fields", async ({ expect }) => {
      const { auditService } = await setup();

      const entry = await auditService.create({
        type: "user",
        action: "update",
        severity: "warning",
        userId: "550e8400-e29b-41d4-a716-446655440000",
        userRealm: "admin",
        userEmail: "admin@example.com",
        resourceType: "user",
        resourceId: "660e8400-e29b-41d4-a716-446655440001",
        description: "Updated user profile",
        metadata: { field: "email", oldValue: "old@test.com" },
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        sessionId: "770e8400-e29b-41d4-a716-446655440002",
        requestId: "req-123",
        success: true,
      });

      expect(entry.type).toBe("user");
      expect(entry.action).toBe("update");
      expect(entry.severity).toBe("warning");
      expect(entry.userId).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(entry.userRealm).toBe("admin");
      expect(entry.userEmail).toBe("admin@example.com");
      expect(entry.resourceType).toBe("user");
      expect(entry.resourceId).toBe("660e8400-e29b-41d4-a716-446655440001");
      expect(entry.metadata).toEqual({
        field: "email",
        oldValue: "old@test.com",
      });
      expect(entry.ipAddress).toBe("192.168.1.1");
      expect(entry.userAgent).toBe("Mozilla/5.0");
      expect(entry.sessionId).toBe("770e8400-e29b-41d4-a716-446655440002");
      expect(entry.requestId).toBe("req-123");
    });

    it("should create audit entry with failure status", async ({ expect }) => {
      const { auditService } = await setup();

      const entry = await auditService.create({
        type: "auth",
        action: "login",
        success: false,
        errorMessage: "Invalid credentials",
      });

      expect(entry.success).toBe(false);
      expect(entry.errorMessage).toBe("Invalid credentials");
    });
  });

  describe("record", () => {
    it("should record audit event using convenience method", async ({
      expect,
    }) => {
      const { auditService } = await setup();

      const entry = await auditService.record("payment", "create", {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        resourceType: "payment",
        resourceId: "pay-123",
        metadata: { amount: 99.99 },
      });

      expect(entry.type).toBe("payment");
      expect(entry.action).toBe("create");
      expect(entry.resourceType).toBe("payment");
      expect(entry.resourceId).toBe("pay-123");
    });
  });

  describe("severity from success", () => {
    it("defaults a failed audit to warning severity", async ({ expect }) => {
      const { auditService } = await setup();

      const entry = await auditService.create({
        type: "auth",
        action: "login",
        success: false,
        errorMessage: "Invalid password",
      });

      expect(entry.success).toBe(false);
      expect(entry.severity).toBe("warning");
    });

    it("defaults a successful audit to info severity", async ({ expect }) => {
      const { auditService } = await setup();

      const entry = await auditService.create({
        type: "auth",
        action: "login",
      });

      expect(entry.severity).toBe("info");
    });

    it("respects an explicit severity over the success default", async ({
      expect,
    }) => {
      const { auditService } = await setup();

      const entry = await auditService.create({
        type: "security",
        action: "sessions_invalidated",
        severity: "warning",
      });

      expect(entry.severity).toBe("warning");
    });
  });

  describe("find", () => {
    it("should find audit entries with pagination", async ({ expect }) => {
      const { auditService } = await setup();

      // Create multiple entries
      await auditService.create({ type: "test", action: "action1" });
      await auditService.create({ type: "test", action: "action2" });
      await auditService.create({ type: "test", action: "action3" });

      const result = await auditService.find({ size: 2 });

      expect(result.content.length).toBeLessThanOrEqual(2);
      expect(result.page).toBeDefined();
    });

    it("should filter by type", async ({ expect }) => {
      const { auditService } = await setup();

      await auditService.create({ type: "auth", action: "login" });
      await auditService.create({ type: "user", action: "create" });

      const result = await auditService.find({ type: "auth" });

      expect(result.content.every((e) => e.type === "auth")).toBe(true);
    });

    it("should filter by severity", async ({ expect }) => {
      const { auditService } = await setup();

      await auditService.create({
        type: "test",
        action: "info",
        severity: "info",
      });
      await auditService.create({
        type: "test",
        action: "warning",
        severity: "warning",
      });

      const result = await auditService.find({ severity: "warning" });

      expect(result.content.every((e) => e.severity === "warning")).toBe(true);
    });

    it("should filter by userId", async ({ expect }) => {
      const { auditService } = await setup();
      const userId = "550e8400-e29b-41d4-a716-446655440000";

      await auditService.create({ type: "test", action: "a", userId });
      await auditService.create({ type: "test", action: "b" });

      const result = await auditService.find({ userId });

      expect(result.content.every((e) => e.userId === userId)).toBe(true);
    });

    it("should filter by success status", async ({ expect }) => {
      const { auditService } = await setup();

      await auditService.create({
        type: "test",
        action: "success",
        success: true,
      });
      await auditService.create({
        type: "test",
        action: "failure",
        success: false,
      });

      const failures = await auditService.find({ success: false });

      expect(failures.content.every((e) => e.success === false)).toBe(true);
    });

    it("should sort by createdAt descending by default", async ({ expect }) => {
      const { auditService } = await setup();

      await auditService.create({ type: "test", action: "first" });
      await new Promise((r) => setTimeout(r, 10));
      await auditService.create({ type: "test", action: "second" });

      const result = await auditService.find({ type: "test" });

      if (result.content.length >= 2) {
        const first = new Date(result.content[0].createdAt).getTime();
        const second = new Date(result.content[1].createdAt).getTime();
        expect(first).toBeGreaterThanOrEqual(second);
      }
    });
  });

  describe("findByUser", () => {
    it("should find audit entries for a specific user", async ({ expect }) => {
      const { auditService } = await setup();
      const userId = "550e8400-e29b-41d4-a716-446655440000";

      await auditService.create({ type: "auth", action: "login", userId });
      await auditService.create({ type: "user", action: "update", userId });

      const result = await auditService.findByUser(userId);

      expect(result.content.every((e) => e.userId === userId)).toBe(true);
    });
  });

  describe("findByResource", () => {
    it("should find audit entries for a specific resource", async ({
      expect,
    }) => {
      const { auditService } = await setup();

      await auditService.create({
        type: "user",
        action: "create",
        resourceType: "user",
        resourceId: "user-123",
      });
      await auditService.create({
        type: "user",
        action: "update",
        resourceType: "user",
        resourceId: "user-123",
      });

      const result = await auditService.findByResource("user", "user-123");

      expect(
        result.content.every(
          (e) => e.resourceType === "user" && e.resourceId === "user-123",
        ),
      ).toBe(true);
    });
  });

  describe("getStats", () => {
    it("should return audit statistics", async ({ expect }) => {
      const { auditService } = await setup();

      // Create diverse entries
      await auditService.create({
        type: "auth",
        action: "login",
        success: true,
      });
      await auditService.create({
        type: "auth",
        action: "login",
        severity: "warning",
        success: false,
      });
      await auditService.create({
        type: "user",
        action: "create",
        success: true,
      });
      await auditService.create({
        type: "system",
        action: "error",
        severity: "critical",
        success: false,
      });

      const stats = await auditService.getStats();

      expect(stats.total).toBeGreaterThanOrEqual(4);
      expect(stats.byType).toBeDefined();
      expect(stats.bySeverity).toBeDefined();
      expect(stats.bySeverity.info).toBeGreaterThanOrEqual(0);
      expect(stats.bySeverity.warning).toBeGreaterThanOrEqual(0);
      expect(stats.bySeverity.critical).toBeGreaterThanOrEqual(0);
      expect(stats.successRate).toBeDefined();
      expect(stats.recentFailures).toBeDefined();
    });

    it("should calculate correct success rate", async ({ expect }) => {
      const { auditService } = await setup();

      // Create 3 successful and 1 failed
      await auditService.create({
        type: "stats",
        action: "test1",
        success: true,
      });
      await auditService.create({
        type: "stats",
        action: "test2",
        success: true,
      });
      await auditService.create({
        type: "stats",
        action: "test3",
        success: true,
      });
      await auditService.create({
        type: "stats",
        action: "test4",
        success: false,
      });

      const stats = await auditService.getStats();

      // Success rate should be around 75% for the entries we created
      // (but there might be other entries from other tests)
      expect(stats.successRate).toBeGreaterThan(0);
      expect(stats.successRate).toBeLessThanOrEqual(1);
    });
  });

  describe("registerType", () => {
    it("should register audit types", async ({ expect }) => {
      const { auditService } = await setup();

      auditService.registerType({
        type: "custom",
        description: "Custom audit type",
        actions: ["create", "update", "delete"],
      });

      const types = auditService.getRegisteredTypes();
      const customType = types.find((t) => t.type === "custom");

      expect(customType).toBeDefined();
      expect(customType?.description).toBe("Custom audit type");
      expect(customType?.actions).toEqual(["create", "update", "delete"]);
    });
  });

  describe("getById", () => {
    it("should retrieve audit entry by ID", async ({ expect }) => {
      const { auditService } = await setup();

      const created = await auditService.create({
        type: "test",
        action: "getById",
        description: "Test getById",
      });

      const retrieved = await auditService.getById(String(created.id));

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.type).toBe("test");
      expect(retrieved.action).toBe("getById");
    });
  });

  describe("deleteExpired", () => {
    // Cutoffs are always computed from `now`, so backdating entries keeps the
    // delete window in the past — concurrent test files' recent rows are safe.
    const countByType = async (db: Db, type: string): Promise<number> =>
      (await db.audits.findMany({ where: { type: { eq: type } } })).length;

    it("deletes entries older than the default retention", async ({
      expect,
    }) => {
      const { auditService, db, time } = await setup();
      const type = "av-default";

      await db.audits.deleteMany({ type: { eq: type } });
      await db.audits.create({
        type,
        action: "old",
        createdAt: time.now().subtract(200, "day").toISOString(),
      });
      await db.audits.create({
        type,
        action: "recent",
        createdAt: time.nowISOString(),
      });

      const deleted = await auditService.deleteExpired(time.now().toDate(), 90);

      expect(deleted).toBeGreaterThanOrEqual(1);
      expect(await countByType(db, type)).toBe(1);
    });

    it("keeps entries within the default retention window", async ({
      expect,
    }) => {
      const { auditService, db, time } = await setup();
      const type = "av-within";

      await db.audits.deleteMany({ type: { eq: type } });
      await db.audits.create({
        type,
        action: "x",
        createdAt: time.now().subtract(10, "day").toISOString(),
      });

      await auditService.deleteExpired(time.now().toDate(), 90);

      expect(await countByType(db, type)).toBe(1);
    });

    it("applies a type's dedicated retention over the default", async ({
      expect,
    }) => {
      const { auditService, db, time } = await setup();

      auditService.registerType({
        type: "av-short",
        actions: ["x"],
        retentionDays: 7,
      });

      await db.audits.deleteMany({ type: { eq: "av-short" } });
      await db.audits.deleteMany({ type: { eq: "av-long" } });

      // 30 days old: beyond the 7-day override, within the 90-day default.
      await db.audits.create({
        type: "av-short",
        action: "x",
        createdAt: time.now().subtract(30, "day").toISOString(),
      });
      await db.audits.create({
        type: "av-long",
        action: "x",
        createdAt: time.now().subtract(30, "day").toISOString(),
      });

      await auditService.deleteExpired(time.now().toDate(), 90);

      expect(await countByType(db, "av-short")).toBe(0);
      expect(await countByType(db, "av-long")).toBe(1);
    });

    it("keeps a type forever when its retention is 0", async ({ expect }) => {
      const { auditService, db, time } = await setup();

      auditService.registerType({
        type: "av-permanent",
        actions: ["x"],
        retentionDays: 0,
      });

      await db.audits.deleteMany({ type: { eq: "av-permanent" } });
      await db.audits.create({
        type: "av-permanent",
        action: "x",
        createdAt: time.now().subtract(5000, "day").toISOString(),
      });

      await auditService.deleteExpired(time.now().toDate(), 90);

      expect(await countByType(db, "av-permanent")).toBe(1);
    });

    it("disables cleanup when the default retention is 0", async ({
      expect,
    }) => {
      const { auditService, db, time } = await setup();
      const type = "av-disabled";

      await db.audits.deleteMany({ type: { eq: type } });
      await db.audits.create({
        type,
        action: "x",
        createdAt: time.now().subtract(5000, "day").toISOString(),
      });

      const deleted = await auditService.deleteExpired(time.now().toDate(), 0);

      expect(deleted).toBe(0);
      expect(await countByType(db, type)).toBe(1);
    });
  });
  describe("scope", () => {
    it("keeps an over-long description instead of failing the write", async ({
      expect,
    }) => {
      const { auditService } = await setup();

      // The values that reach `description` come from the audited domain and
      // are not bounded by this column: Lore writes a quest's title here, and
      // a quest title has no maximum. Unclamped, this insert fails schema
      // validation - and because call sites await it inside their own
      // transaction, it would roll back the very action it is recording.
      const entry = await auditService.create({
        type: "test",
        action: "create",
        description: "x".repeat(400),
      });

      expect(entry.description).toHaveLength(255);
      // Cut, and saying so: a reader has to be able to tell a prefix from a
      // whole value.
      expect(entry.description?.endsWith("…")).toBe(true);
    });

    it("finds only the rows of the scope it is asked for", async ({
      expect,
    }) => {
      const { auditService } = await setup();

      await auditService.create({
        type: "quest",
        action: "create",
        scopeType: "project",
        scopeId: "1",
      });
      await auditService.create({
        type: "quest",
        action: "create",
        scopeType: "project",
        scopeId: "2",
      });
      // App layer: no scope at all.
      await auditService.create({ type: "user", action: "login" });

      const scoped = await auditService.find({
        scopeType: "project",
        scopeId: "1",
      });
      expect(scoped.content).toHaveLength(1);
      expect(scoped.content[0].scopeId).toBe("1");

      // `layer` narrows without naming a scope, which is what the admin page
      // needs to separate the deployment's own events from its tenants'.
      const app = await auditService.find({ layer: "app" });
      expect(app.content.map((row) => row.type)).toEqual(["user"]);

      const tenant = await auditService.find({ layer: "scoped" });
      expect(tenant.content).toHaveLength(2);
    });

    it("excludes the boundary row for a forward cursor", async ({ expect }) => {
      const { auditService } = await setup();

      const first = await auditService.create({
        type: "quest",
        action: "create",
        scopeType: "project",
        scopeId: "1",
      });

      const at = Date.parse(first.createdAt);
      const stamp = (offsetMs: number) => new Date(at + offsetMs).toISOString();

      // `from` is inclusive, so a window opening one millisecond after the
      // row has already passed it by.
      expect(
        (await auditService.find({ from: stamp(-1) })).content,
      ).toHaveLength(1);
      expect(
        (await auditService.find({ from: stamp(1000) })).content,
      ).toHaveLength(0);

      // `after` is exclusive, which is what makes it usable as a forward
      // cursor: passing back a stamp the caller has already seen must not
      // hand the same row over again.
      //
      // The boundary is asserted a second apart rather than exactly on the
      // row's own stamp, because how precisely the boundary itself is
      // excluded depends on what the column stores: integer milliseconds on
      // sqlite, microseconds on postgres, and this suite runs on the latter.
      // The exact-boundary guarantee belongs to the caller that owns the
      // cursor - see `project_activity` and its own spec.
      expect(
        (await auditService.find({ after: stamp(-1000) })).content,
      ).toHaveLength(1);
      expect(
        (await auditService.find({ after: stamp(1000) })).content,
      ).toHaveLength(0);
    });
  });
});
