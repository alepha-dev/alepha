import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { SecurityError, SecurityProvider } from "../../src/security";

/**
 * Bug #1: Multi-layer Wildcard Permission Validation Fails After App Start
 *
 * Issue: When creating roles with multi-layer wildcard permissions (e.g., "admin:api:*")
 * after app.start(), the validation logic only checked if parts[1] === "*", which fails
 * for deeper wildcards.
 *
 * Expected: Multi-layer wildcards should be validated correctly by checking if any
 * permission exists with the matching group prefix.
 */
describe("Bug #1: Multi-layer Wildcard Permission Validation After App Start", () => {
  it("should allow creating role with 2-layer wildcard after app start", async () => {
    const app = Alepha.create();
    const sec = app.inject(SecurityProvider);

    sec.createPermission("hello:hey");
    sec.createPermission("hello:ho");

    await app.start();

    // This should work - 2-layer wildcard with existing permissions
    expect(() =>
      sec.createRole({
        name: "superuser",
        permissions: [{ name: "hello:*" }],
      }),
    ).not.toThrow();

    expect(sec.can("superuser", "hello:hey")).toEqual(true);
    expect(sec.can("superuser", "hello:ho")).toEqual(true);
  });

  it("should allow creating role with 3-layer wildcard after app start", async () => {
    const app = Alepha.create();
    const sec = app.inject(SecurityProvider);

    sec.createPermission("admin:api:users");
    sec.createPermission("admin:api:posts");

    await app.start();

    // This is the bug - should work but previously failed
    expect(() =>
      sec.createRole({
        name: "api-admin",
        permissions: [{ name: "admin:api:*" }],
      }),
    ).not.toThrow();

    expect(sec.can("api-admin", "admin:api:users")).toEqual(true);
    expect(sec.can("api-admin", "admin:api:posts")).toEqual(true);
  });

  it("should allow creating role with 4-layer wildcard after app start", async () => {
    const app = Alepha.create();
    const sec = app.inject(SecurityProvider);

    sec.createPermission("admin:api:v1:users");
    sec.createPermission("admin:api:v1:posts");

    await app.start();

    // Deep wildcard should work
    expect(() =>
      sec.createRole({
        name: "api-v1-admin",
        permissions: [{ name: "admin:api:v1:*" }],
      }),
    ).not.toThrow();

    expect(sec.can("api-v1-admin", "admin:api:v1:users")).toEqual(true);
    expect(sec.can("api-v1-admin", "admin:api:v1:posts")).toEqual(true);
  });

  it("should allow wildcard that matches nested groups", async () => {
    const app = Alepha.create();
    const sec = app.inject(SecurityProvider);

    // Create permissions with different nesting levels under same prefix
    sec.createPermission("admin:api:users:read");
    sec.createPermission("admin:api:users:write");
    sec.createPermission("admin:api:posts:delete");

    await app.start();

    // Wildcard at intermediate level should work
    expect(() =>
      sec.createRole({
        name: "api-manager",
        permissions: [{ name: "admin:api:*" }],
      }),
    ).not.toThrow();

    expect(sec.can("api-manager", "admin:api:users:read")).toEqual(true);
    expect(sec.can("api-manager", "admin:api:users:write")).toEqual(true);
    expect(sec.can("api-manager", "admin:api:posts:delete")).toEqual(true);
  });

  it("should reject wildcard when no matching permissions exist", async () => {
    const app = Alepha.create();
    const sec = app.inject(SecurityProvider);

    sec.createPermission("hello:hey");

    await app.start();

    // This should fail - no permissions match "admin:*"
    expect(() =>
      sec.createRole({
        name: "admin",
        permissions: [{ name: "admin:*" }],
      }),
    ).toThrow(SecurityError);

    expect(() =>
      sec.createRole({
        name: "admin-api",
        permissions: [{ name: "admin:api:*" }],
      }),
    ).toThrow(SecurityError);
  });

  it("should allow global wildcard after app start", async () => {
    const app = Alepha.create();
    const sec = app.inject(SecurityProvider);

    sec.createPermission("anything");

    await app.start();

    // Global wildcard should always work
    expect(() =>
      sec.createRole({
        name: "admin",
        permissions: [{ name: "*" }],
      }),
    ).not.toThrow();

    expect(sec.can("admin", "anything")).toEqual(true);
  });

  it("should allow exact permission match after app start", async () => {
    const app = Alepha.create();
    const sec = app.inject(SecurityProvider);

    sec.createPermission("admin:api:users:read");

    await app.start();

    // Exact permission should work
    expect(() =>
      sec.createRole({
        name: "reader",
        permissions: [{ name: "admin:api:users:read" }],
      }),
    ).not.toThrow();

    expect(sec.can("reader", "admin:api:users:read")).toEqual(true);
  });

  it("should reject exact permission when it doesn't exist", async () => {
    const app = Alepha.create();
    const sec = app.inject(SecurityProvider);

    sec.createPermission("hello:hey");

    await app.start();

    // Non-existent exact permission should fail
    expect(() =>
      sec.createRole({
        name: "user",
        permissions: [{ name: "admin:api:users:read" }],
      }),
    ).toThrow(SecurityError);
  });

  it("should handle mixed wildcards and exact permissions", async () => {
    const app = Alepha.create();
    const sec = app.inject(SecurityProvider);

    sec.createPermission("admin:api:users:read");
    sec.createPermission("admin:api:posts:write");
    sec.createPermission("public:read");

    await app.start();

    // Mix of wildcard and exact should work if all exist
    expect(() =>
      sec.createRole({
        name: "mixed",
        permissions: [
          { name: "admin:api:*" }, // wildcard - should match
          { name: "public:read" }, // exact - exists
        ],
      }),
    ).not.toThrow();

    expect(sec.can("mixed", "admin:api:users:read")).toEqual(true);
    expect(sec.can("mixed", "public:read")).toEqual(true);
  });

  it("should handle wildcard at exact group level", async () => {
    const app = Alepha.create();
    const sec = app.inject(SecurityProvider);

    // Permission with exact group "admin:api"
    sec.createPermission({ group: "admin:api", name: "execute" });
    // Permission with nested group "admin:api:users"
    sec.createPermission({ group: "admin:api:users", name: "read" });

    await app.start();

    // Wildcard "admin:api:*" should match both
    expect(() =>
      sec.createRole({
        name: "api-all",
        permissions: [{ name: "admin:api:*" }],
      }),
    ).not.toThrow();

    expect(sec.can("api-all", "admin:api:execute")).toEqual(true);
    expect(sec.can("api-all", "admin:api:users:read")).toEqual(true);
  });
});
