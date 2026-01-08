import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import {
  InvalidPermissionError,
  SecurityError,
  SecurityProvider,
} from "../index.ts";

describe("SecurityProvider - Multi-layer Permissions", () => {
  describe("Permission Creation", () => {
    it("should create permissions with multi-layer groups", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      // Two-layer permissions
      const p1 = sec.createPermission("users:read");
      expect(p1.group).toEqual("users");
      expect(p1.name).toEqual("read");

      // Three-layer permissions
      const p2 = sec.createPermission("management:users:create");
      expect(p2.group).toEqual("management:users");
      expect(p2.name).toEqual("create");

      // Four-layer permissions
      const p3 = sec.createPermission("admin:api:users:read");
      expect(p3.group).toEqual("admin:api:users");
      expect(p3.name).toEqual("read");

      // Five-layer permissions
      const p4 = sec.createPermission("admin:api:v1:users:delete");
      expect(p4.group).toEqual("admin:api:v1:users");
      expect(p4.name).toEqual("delete");

      expect(sec.getPermissions().length).toEqual(4);
    });

    it("should convert multi-layer permissions to strings correctly", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      const p1 = sec.createPermission("management:users:create");
      expect(sec.permissionToString(p1)).toEqual("management:users:create");

      const p2 = sec.createPermission("admin:api:users:read");
      expect(sec.permissionToString(p2)).toEqual("admin:api:users:read");
    });

    it("should reject invalid multi-layer permissions", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      const invalid = [
        ":",
        ":users",
        "users:",
        "users::",
        "users::read",
        "admin::",
        "admin::users:read",
        "admin:api:",
        ":admin:api:users",
      ];

      for (const permission of invalid) {
        expect(() => sec.createPermission(permission)).toThrow(
          InvalidPermissionError,
        );
      }
    });
  });

  describe("Wildcard Matching", () => {
    it("should match permissions with two-layer wildcards", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      sec.createPermission("users:read");
      sec.createPermission("users:write");
      sec.createPermission("users:delete");
      sec.createPermission("posts:read");

      sec.createRole({
        name: "user-manager",
        permissions: [{ name: "users:*" }],
      });

      expect(sec.can("user-manager", "users:read")).toEqual(true);
      expect(sec.can("user-manager", "users:write")).toEqual(true);
      expect(sec.can("user-manager", "users:delete")).toEqual(true);
      expect(sec.can("user-manager", "posts:read")).toEqual(false);
    });

    it("should match permissions with three-layer wildcards", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      sec.createPermission("management:users:read");
      sec.createPermission("management:users:write");
      sec.createPermission("management:posts:read");
      sec.createPermission("management:posts:write");
      sec.createPermission("public:posts:read");

      sec.createRole({
        name: "user-manager",
        permissions: [{ name: "management:users:*" }],
      });

      expect(sec.can("user-manager", "management:users:read")).toEqual(true);
      expect(sec.can("user-manager", "management:users:write")).toEqual(true);
      expect(sec.can("user-manager", "management:posts:read")).toEqual(false);
      expect(sec.can("user-manager", "public:posts:read")).toEqual(false);
    });

    it("should match permissions with four-layer wildcards", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      sec.createPermission("admin:api:users:read");
      sec.createPermission("admin:api:users:write");
      sec.createPermission("admin:api:posts:read");
      sec.createPermission("admin:web:users:read");

      sec.createRole({
        name: "api-admin",
        permissions: [{ name: "admin:api:*" }],
      });

      expect(sec.can("api-admin", "admin:api:users:read")).toEqual(true);
      expect(sec.can("api-admin", "admin:api:users:write")).toEqual(true);
      expect(sec.can("api-admin", "admin:api:posts:read")).toEqual(true);
      expect(sec.can("api-admin", "admin:web:users:read")).toEqual(false);
    });

    it("should match permissions with nested wildcards", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      sec.createPermission("admin:api:v1:users:read");
      sec.createPermission("admin:api:v1:users:write");
      sec.createPermission("admin:api:v1:posts:read");
      sec.createPermission("admin:api:v2:users:read");

      // Wildcard at different levels
      sec.createRole({
        name: "admin-all",
        permissions: [{ name: "admin:*" }],
      });

      sec.createRole({
        name: "api-all",
        permissions: [{ name: "admin:api:*" }],
      });

      sec.createRole({
        name: "api-v1-all",
        permissions: [{ name: "admin:api:v1:*" }],
      });

      sec.createRole({
        name: "api-v1-users",
        permissions: [{ name: "admin:api:v1:users:*" }],
      });

      // admin-all should match everything
      expect(sec.can("admin-all", "admin:api:v1:users:read")).toEqual(true);
      expect(sec.can("admin-all", "admin:api:v2:users:read")).toEqual(true);

      // api-all should match all admin:api permissions
      expect(sec.can("api-all", "admin:api:v1:users:read")).toEqual(true);
      expect(sec.can("api-all", "admin:api:v2:users:read")).toEqual(true);

      // api-v1-all should only match admin:api:v1 permissions
      expect(sec.can("api-v1-all", "admin:api:v1:users:read")).toEqual(true);
      expect(sec.can("api-v1-all", "admin:api:v1:posts:read")).toEqual(true);
      expect(sec.can("api-v1-all", "admin:api:v2:users:read")).toEqual(false);

      // api-v1-users should only match admin:api:v1:users permissions
      expect(sec.can("api-v1-users", "admin:api:v1:users:read")).toEqual(true);
      expect(sec.can("api-v1-users", "admin:api:v1:users:write")).toEqual(true);
      expect(sec.can("api-v1-users", "admin:api:v1:posts:read")).toEqual(false);
    });
  });

  describe("Exclude with Multi-layer Permissions", () => {
    it("should exclude specific multi-layer permissions", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      sec.createPermission("admin:api:users:read");
      sec.createPermission("admin:api:users:write");
      sec.createPermission("admin:api:users:delete");

      sec.createRole({
        name: "api-admin-safe",
        permissions: [
          { name: "admin:api:*", exclude: ["admin:api:users:delete"] },
        ],
      });

      expect(sec.can("api-admin-safe", "admin:api:users:read")).toEqual(true);
      expect(sec.can("api-admin-safe", "admin:api:users:write")).toEqual(true);
      expect(sec.can("api-admin-safe", "admin:api:users:delete")).toEqual(
        false,
      );
    });

    it("should exclude with wildcard patterns in multi-layer permissions", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      sec.createPermission("admin:api:users:read");
      sec.createPermission("admin:api:users:write");
      sec.createPermission("admin:api:users:delete");
      sec.createPermission("admin:api:posts:read");
      sec.createPermission("admin:api:posts:write");

      sec.createRole({
        name: "admin-no-users",
        permissions: [{ name: "admin:api:*", exclude: ["admin:api:users:*"] }],
      });

      expect(sec.can("admin-no-users", "admin:api:users:read")).toEqual(false);
      expect(sec.can("admin-no-users", "admin:api:users:write")).toEqual(false);
      expect(sec.can("admin-no-users", "admin:api:users:delete")).toEqual(
        false,
      );
      expect(sec.can("admin-no-users", "admin:api:posts:read")).toEqual(true);
      expect(sec.can("admin-no-users", "admin:api:posts:write")).toEqual(true);
    });

    it("should exclude with nested wildcard patterns", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      sec.createPermission("admin:api:v1:users:read");
      sec.createPermission("admin:api:v1:users:write");
      sec.createPermission("admin:api:v1:posts:read");
      sec.createPermission("admin:api:v2:users:read");

      sec.createRole({
        name: "admin-no-v1",
        permissions: [{ name: "admin:*", exclude: ["admin:api:v1:*"] }],
      });

      expect(sec.can("admin-no-v1", "admin:api:v1:users:read")).toEqual(false);
      expect(sec.can("admin-no-v1", "admin:api:v1:posts:read")).toEqual(false);
      expect(sec.can("admin-no-v1", "admin:api:v2:users:read")).toEqual(true);
    });
  });

  describe("getPermissions with Multi-layer", () => {
    it("should get permissions with multi-layer wildcards", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      sec.createPermission("admin:api:users:read");
      sec.createPermission("admin:api:users:write");
      sec.createPermission("admin:api:posts:read");
      sec.createPermission("admin:web:users:read");

      sec.createRole({
        name: "api-manager",
        permissions: [{ name: "admin:api:*" }],
      });

      const permissions = sec.getPermissions({ roles: ["api-manager"] });

      expect(permissions.length).toEqual(3);
      expect(permissions).toContainEqual({
        group: "admin:api:users",
        name: "read",
      });
      expect(permissions).toContainEqual({
        group: "admin:api:users",
        name: "write",
      });
      expect(permissions).toContainEqual({
        group: "admin:api:posts",
        name: "read",
      });
      expect(permissions).not.toContainEqual({
        group: "admin:web:users",
        name: "read",
      });
    });

    it("should get permissions with nested wildcard levels", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      sec.createPermission("admin:api:v1:users:read");
      sec.createPermission("admin:api:v1:posts:read");
      sec.createPermission("admin:api:v2:users:read");

      sec.createRole({
        name: "api-v1-manager",
        permissions: [{ name: "admin:api:v1:*" }],
      });

      const permissions = sec.getPermissions({ roles: ["api-v1-manager"] });

      expect(permissions.length).toEqual(2);
      expect(permissions).toContainEqual({
        group: "admin:api:v1:users",
        name: "read",
      });
      expect(permissions).toContainEqual({
        group: "admin:api:v1:posts",
        name: "read",
      });
      expect(permissions).not.toContainEqual({
        group: "admin:api:v2:users",
        name: "read",
      });
    });

    it("should get permissions with exclude patterns", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      sec.createPermission("admin:api:users:read");
      sec.createPermission("admin:api:users:write");
      sec.createPermission("admin:api:users:delete");

      sec.createRole({
        name: "safe-admin",
        permissions: [
          { name: "admin:api:*", exclude: ["admin:api:users:delete"] },
        ],
      });

      const permissions = sec.getPermissions({ roles: ["safe-admin"] });

      expect(permissions.length).toEqual(2);
      expect(permissions).toContainEqual({
        group: "admin:api:users",
        name: "read",
      });
      expect(permissions).toContainEqual({
        group: "admin:api:users",
        name: "write",
      });
      expect(permissions).not.toContainEqual({
        group: "admin:api:users",
        name: "delete",
      });
    });
  });

  describe("Ownership with Multi-layer Permissions", () => {
    it("should handle ownership with multi-layer permissions", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      sec.createPermission("management:users:read");
      sec.createPermission("management:users:write");

      sec.createRole({
        name: "user-owner",
        permissions: [{ name: "management:users:*", ownership: true }],
      });

      sec.createRole({
        name: "user-manager",
        permissions: [{ name: "management:users:*" }],
      });

      expect(
        sec.checkPermission("management:users:read", "user-owner"),
      ).toEqual({
        ownership: true,
        isAuthorized: true,
      });

      expect(
        sec.checkPermission("management:users:read", "user-manager"),
      ).toEqual({
        ownership: false,
        isAuthorized: true,
      });

      expect(
        sec.checkPermission(
          "management:users:read",
          "user-owner",
          "user-manager",
        ),
      ).toEqual({
        ownership: false,
        isAuthorized: true,
      });
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle mixed permission depths", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      // Different depth permissions
      sec.createPermission("read"); // 1 level
      sec.createPermission("users:write"); // 2 levels
      sec.createPermission("admin:users:delete"); // 3 levels
      sec.createPermission("admin:api:v1:execute"); // 4 levels

      sec.createRole({
        name: "mixed-role",
        permissions: [
          { name: "read" },
          { name: "users:*" },
          { name: "admin:users:*" },
          { name: "admin:api:*" },
        ],
      });

      expect(sec.can("mixed-role", "read")).toEqual(true);
      expect(sec.can("mixed-role", "users:write")).toEqual(true);
      expect(sec.can("mixed-role", "admin:users:delete")).toEqual(true);
      expect(sec.can("mixed-role", "admin:api:v1:execute")).toEqual(true);
    });

    it("should handle overlapping wildcards", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      sec.createPermission("admin:api:users:read");

      sec.createRole({
        name: "overlapping",
        permissions: [
          { name: "admin:*", ownership: true },
          { name: "admin:api:*" }, // More specific, should override ownership
        ],
      });

      // The more specific permission without ownership should take precedence
      expect(
        sec.checkPermission("admin:api:users:read", "overlapping"),
      ).toEqual({
        ownership: false,
        isAuthorized: true,
      });
    });

    it("should handle role with multiple levels of exclusions", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      sec.createPermission("admin:api:v1:users:read");
      sec.createPermission("admin:api:v1:users:write");
      sec.createPermission("admin:api:v1:posts:read");
      sec.createPermission("admin:api:v2:users:read");

      sec.createRole({
        name: "complex-excludes",
        permissions: [
          {
            name: "admin:*",
            exclude: ["admin:api:v1:users:*", "admin:api:v2:*"],
          },
        ],
      });

      expect(sec.can("complex-excludes", "admin:api:v1:users:read")).toEqual(
        false,
      );
      expect(sec.can("complex-excludes", "admin:api:v1:users:write")).toEqual(
        false,
      );
      expect(sec.can("complex-excludes", "admin:api:v1:posts:read")).toEqual(
        true,
      );
      expect(sec.can("complex-excludes", "admin:api:v2:users:read")).toEqual(
        false,
      );
    });

    it("should not match exact group as wildcard", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      sec.createPermission("admin:api:read");
      sec.createPermission("admin:api:users:read");

      sec.createRole({
        name: "specific",
        permissions: [{ name: "admin:api:*" }],
      });

      expect(sec.can("specific", "admin:api:users:read")).toEqual(true);
      expect(sec.can("specific", "admin:api:read")).toEqual(true);
    });
  });

  describe("Error Handling", () => {
    it("should throw error for non-existent role with multi-layer permissions", () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      sec.createPermission("admin:api:users:read");

      expect(() => sec.can("non-existent", "admin:api:users:read")).toThrow(
        SecurityError,
      );
    });

    it("should throw error when creating role with invalid multi-layer permission", async () => {
      const app = Alepha.create();
      const sec = app.inject(SecurityProvider);

      await app.start();

      expect(() =>
        sec.createRole({
          name: "invalid-role",
          permissions: [{ name: "admin:api:invalid:permission" }],
        }),
      ).toThrow(SecurityError);
    });
  });
});
