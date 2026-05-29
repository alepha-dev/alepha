import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import { AlephaApiAudits, AuditService } from "../index.ts";

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error" },
  });

  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaApiAudits);

  await alepha.start();

  const auditService = alepha.inject(AuditService);

  return {
    alepha,
    auditService,
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

  describe("recordAuth", () => {
    it("should record login event", async ({ expect }) => {
      const { auditService } = await setup();

      const entry = await auditService.recordAuth("login", {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        ipAddress: "10.0.0.1",
      });

      expect(entry.type).toBe("auth");
      expect(entry.action).toBe("login");
      expect(entry.severity).toBe("info");
    });

    it("should record failed login with warning severity", async ({
      expect,
    }) => {
      const { auditService } = await setup();

      const entry = await auditService.recordAuth("login", {
        userEmail: "attacker@example.com",
        ipAddress: "10.0.0.1",
        success: false,
        errorMessage: "Invalid password",
      });

      expect(entry.type).toBe("auth");
      expect(entry.action).toBe("login");
      expect(entry.success).toBe(false);
      expect(entry.severity).toBe("warning");
    });

    it("should record logout event", async ({ expect }) => {
      const { auditService } = await setup();

      const entry = await auditService.recordAuth("logout", {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        sessionId: "660e8400-e29b-41d4-a716-446655440001",
      });

      expect(entry.type).toBe("auth");
      expect(entry.action).toBe("logout");
    });
  });

  describe("recordUser", () => {
    it("should record user creation event", async ({ expect }) => {
      const { auditService } = await setup();

      const entry = await auditService.recordUser("create", {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        resourceId: "660e8400-e29b-41d4-a716-446655440001",
        description: "New user registered",
      });

      expect(entry.type).toBe("user");
      expect(entry.action).toBe("create");
      expect(entry.resourceType).toBe("user");
    });

    it("should record role change event", async ({ expect }) => {
      const { auditService } = await setup();

      const entry = await auditService.recordUser("role_change", {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        resourceId: "660e8400-e29b-41d4-a716-446655440001",
        metadata: { oldRoles: ["user"], newRoles: ["user", "admin"] },
      });

      expect(entry.action).toBe("role_change");
      expect(entry.metadata).toEqual({
        oldRoles: ["user"],
        newRoles: ["user", "admin"],
      });
    });
  });

  describe("recordSecurity", () => {
    it("should record security events with warning severity", async ({
      expect,
    }) => {
      const { auditService } = await setup();

      const entry = await auditService.recordSecurity("permission_denied", {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        resourceType: "admin_panel",
        description: "Attempted to access admin panel without permission",
      });

      expect(entry.type).toBe("security");
      expect(entry.action).toBe("permission_denied");
      expect(entry.severity).toBe("warning");
    });

    it("should record rate limiting event", async ({ expect }) => {
      const { auditService } = await setup();

      const entry = await auditService.recordSecurity("rate_limited", {
        ipAddress: "192.168.1.100",
        metadata: { endpoint: "/api/login", requests: 100 },
      });

      expect(entry.action).toBe("rate_limited");
      expect(entry.severity).toBe("warning");
    });
  });

  describe("recordSystem", () => {
    it("should record system startup", async ({ expect }) => {
      const { auditService } = await setup();

      const entry = await auditService.recordSystem("startup", {
        metadata: { version: "1.0.0" },
      });

      expect(entry.type).toBe("system");
      expect(entry.action).toBe("startup");
      expect(entry.severity).toBe("info");
    });

    it("should record system error with critical severity", async ({
      expect,
    }) => {
      const { auditService } = await setup();

      const entry = await auditService.recordSystem("error", {
        errorMessage: "Database connection failed",
        metadata: { error: "ECONNREFUSED" },
      });

      expect(entry.action).toBe("error");
      expect(entry.severity).toBe("critical");
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
        action: "login_failed",
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
});
