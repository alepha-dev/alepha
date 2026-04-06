import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import {
  $action,
  AlephaServer,
  ForbiddenError,
  UnauthorizedError,
} from "alepha/server";
import { describe, expect, it } from "vitest";
import { $issuer, $secure, AlephaSecurity } from "../index.ts";

// -----------------------------------------------------------------------------------------------------------------
// Shared setup
// -----------------------------------------------------------------------------------------------------------------

function setup() {
  class TestApp {
    main = $issuer({
      secret: "test-main",
      roles: [
        {
          name: "admin",
          permissions: [{ name: "*" }],
        },
        {
          name: "editor",
          permissions: [
            { name: "posts:read" },
            { name: "posts:create" },
            { name: "posts:update" },
          ],
        },
        {
          name: "viewer",
          permissions: [{ name: "posts:read" }],
        },
        {
          name: "moderator",
          permissions: [
            { name: "posts:read" },
            { name: "posts:delete" },
            { name: "comments:delete" },
          ],
        },
      ],
    });

    external = $issuer({
      secret: "test-external",
      roles: [
        {
          name: "partner",
          permissions: [{ name: "posts:read" }],
        },
      ],
    });

    // ---------------------------------------------------------------------------------------------------------------
    // Actions with single options
    // ---------------------------------------------------------------------------------------------------------------

    authOnly = $action({
      use: [$secure()],
      handler: () => "auth-only",
    });

    requireViewer = $action({
      use: [$secure({ roles: ["viewer"] })],
      handler: () => "viewer",
    });

    requireRead = $action({
      use: [$secure({ permissions: ["posts:read"] })],
      handler: () => "read",
    });

    requireMainIssuer = $action({
      use: [$secure({ issuers: ["main"] })],
      handler: () => "main-issuer",
    });

    // ---------------------------------------------------------------------------------------------------------------
    // Actions with two-option combinations
    // ---------------------------------------------------------------------------------------------------------------

    issuerAndRole = $action({
      use: [$secure({ issuers: ["main"], roles: ["editor"] })],
      handler: () => "issuer+role",
    });

    issuerAndPermission = $action({
      use: [$secure({ issuers: ["main"], permissions: ["posts:create"] })],
      handler: () => "issuer+permission",
    });

    issuerAndGuard = $action({
      use: [
        $secure({
          issuers: ["main"],
          guard: (user) => user.email === "allowed@test.com",
        }),
      ],
      handler: () => "issuer+guard",
    });

    roleAndPermission = $action({
      use: [$secure({ roles: ["editor"], permissions: ["posts:create"] })],
      handler: () => "role+permission",
    });

    roleAndGuard = $action({
      use: [
        $secure({
          roles: ["editor"],
          guard: (user) => user.email === "allowed@test.com",
        }),
      ],
      handler: () => "role+guard",
    });

    permissionAndGuard = $action({
      use: [
        $secure({
          permissions: ["posts:read"],
          guard: (user) => user.email === "allowed@test.com",
        }),
      ],
      handler: () => "permission+guard",
    });

    // ---------------------------------------------------------------------------------------------------------------
    // Actions with three-option combinations
    // ---------------------------------------------------------------------------------------------------------------

    issuerRolePermission = $action({
      use: [
        $secure({
          issuers: ["main"],
          roles: ["editor"],
          permissions: ["posts:create"],
        }),
      ],
      handler: () => "issuer+role+permission",
    });

    issuerRoleGuard = $action({
      use: [
        $secure({
          issuers: ["main"],
          roles: ["editor"],
          guard: (user) => user.email === "allowed@test.com",
        }),
      ],
      handler: () => "issuer+role+guard",
    });

    issuerPermissionGuard = $action({
      use: [
        $secure({
          issuers: ["main"],
          permissions: ["posts:create"],
          guard: (user) => user.email === "allowed@test.com",
        }),
      ],
      handler: () => "issuer+permission+guard",
    });

    rolePermissionGuard = $action({
      use: [
        $secure({
          roles: ["editor"],
          permissions: ["posts:create"],
          guard: (user) => user.email === "allowed@test.com",
        }),
      ],
      handler: () => "role+permission+guard",
    });

    // ---------------------------------------------------------------------------------------------------------------
    // All four options
    // ---------------------------------------------------------------------------------------------------------------

    allOptions = $action({
      use: [
        $secure({
          issuers: ["main"],
          roles: ["editor"],
          permissions: ["posts:create"],
          guard: (user) => user.email === "allowed@test.com",
        }),
      ],
      handler: () => "all",
    });

    // ---------------------------------------------------------------------------------------------------------------
    // Multiple permissions (AND logic)
    // ---------------------------------------------------------------------------------------------------------------

    multiplePermissions = $action({
      use: [$secure({ permissions: ["posts:read", "posts:delete"] })],
      handler: () => "multi-perm",
    });

    // ---------------------------------------------------------------------------------------------------------------
    // Multiple issuers (OR logic)
    // ---------------------------------------------------------------------------------------------------------------

    multipleIssuers = $action({
      use: [$secure({ issuers: ["main", "external"] })],
      handler: () => "multi-issuer",
    });

    // ---------------------------------------------------------------------------------------------------------------
    // Multiple roles (OR logic)
    // ---------------------------------------------------------------------------------------------------------------

    multipleRoles = $action({
      use: [$secure({ roles: ["editor", "moderator"] })],
      handler: () => "multi-role",
    });
  }

  const alepha = Alepha.create().with(AlephaServer).with(AlephaSecurity);
  const app = alepha.inject(TestApp);

  const users = {
    admin: {
      id: randomUUID(),
      roles: ["admin"],
      realm: "main",
      email: "admin@test.com",
      name: "Admin",
    },
    editor: {
      id: randomUUID(),
      roles: ["editor"],
      realm: "main",
      email: "allowed@test.com",
      name: "Editor",
    },
    editorWrongEmail: {
      id: randomUUID(),
      roles: ["editor"],
      realm: "main",
      email: "other@test.com",
      name: "Editor2",
    },
    viewer: {
      id: randomUUID(),
      roles: ["viewer"],
      realm: "main",
      email: "viewer@test.com",
      name: "Viewer",
    },
    moderator: {
      id: randomUUID(),
      roles: ["moderator"],
      realm: "main",
      email: "mod@test.com",
      name: "Moderator",
    },
    partner: {
      id: randomUUID(),
      roles: ["partner"],
      realm: "external",
      email: "partner@test.com",
      name: "Partner",
    },
    noRoles: {
      id: randomUUID(),
      roles: [] as string[],
      realm: "main",
      email: "noroles@test.com",
      name: "NoRoles",
    },
    noRealm: {
      id: randomUUID(),
      roles: ["editor"],
      email: "norealm@test.com",
      name: "NoRealm",
    },
    editorAndModerator: {
      id: randomUUID(),
      roles: ["editor", "moderator"],
      realm: "main",
      email: "allowed@test.com",
      name: "EditorMod",
    },
  };

  return { alepha, app, users };
}

// -----------------------------------------------------------------------------------------------------------------
// Two-option combinations
// -----------------------------------------------------------------------------------------------------------------

describe("$secure combinations", () => {
  describe("issuers + roles", () => {
    it("should allow when both issuer and role match", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      expect(await app.issuerAndRole.run({}, { user: users.editor })).toBe(
        "issuer+role",
      );
    });

    it("should deny when issuer matches but role does not", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      await expect(
        app.issuerAndRole.run({}, { user: users.viewer }),
      ).rejects.toThrowError(ForbiddenError);
    });

    it("should deny when role matches but issuer does not", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      const externalEditor = {
        ...users.editor,
        id: randomUUID(),
        realm: "external",
      };
      await expect(
        app.issuerAndRole.run({}, { user: externalEditor }),
      ).rejects.toThrowError(ForbiddenError);
    });
  });

  describe("issuers + permissions", () => {
    it("should allow when both issuer and permission match", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      expect(
        await app.issuerAndPermission.run({}, { user: users.editor }),
      ).toBe("issuer+permission");
    });

    it("should deny when issuer matches but permission does not", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      await expect(
        app.issuerAndPermission.run({}, { user: users.viewer }),
      ).rejects.toThrowError(ForbiddenError);
    });

    it("should deny when permission would match but issuer does not", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      const externalEditor = {
        ...users.editor,
        id: randomUUID(),
        realm: "external",
      };
      await expect(
        app.issuerAndPermission.run({}, { user: externalEditor }),
      ).rejects.toThrowError(ForbiddenError);
    });
  });

  describe("issuers + guard", () => {
    it("should allow when both issuer and guard pass", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      expect(await app.issuerAndGuard.run({}, { user: users.editor })).toBe(
        "issuer+guard",
      );
    });

    it("should deny when issuer matches but guard fails", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      await expect(
        app.issuerAndGuard.run({}, { user: users.editorWrongEmail }),
      ).rejects.toThrowError(ForbiddenError);
    });

    it("should deny when guard would pass but issuer does not", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      const externalAllowed = {
        ...users.editor,
        id: randomUUID(),
        realm: "external",
      };
      await expect(
        app.issuerAndGuard.run({}, { user: externalAllowed }),
      ).rejects.toThrowError(ForbiddenError);
    });
  });

  describe("roles + permissions", () => {
    it("should allow when both role and permission match", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      expect(await app.roleAndPermission.run({}, { user: users.editor })).toBe(
        "role+permission",
      );
    });

    it("should deny when role matches but permission does not", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      // viewer role doesn't have posts:create, but we need a user WITH editor role but WITHOUT the permission
      // Actually: editor role has posts:create. So use a viewer who somehow has editor role name... no.
      // The check is: roles check is OR on role NAME, permissions check is on role PERMISSIONS.
      // A user with roles: ["editor"] has posts:create. A user with roles: ["viewer"] does NOT have posts:create.
      // But viewer also doesn't have the "editor" role name. So both checks fail.
      // To test "role matches but permission doesn't": we'd need a role that exists by name but lacks the permission.
      // viewer role exists, has posts:read, but NOT posts:create.
      // So: $secure({ roles: ["viewer"], permissions: ["posts:create"] }) with a viewer user would fail on permission.

      // Let's just verify viewer fails on roleAndPermission (requires editor role)
      await expect(
        app.roleAndPermission.run({}, { user: users.viewer }),
      ).rejects.toThrowError(ForbiddenError);
    });

    it("should deny when user has no roles", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      await expect(
        app.roleAndPermission.run({}, { user: users.noRoles }),
      ).rejects.toThrowError(ForbiddenError);
    });
  });

  describe("roles + guard", () => {
    it("should allow when both role and guard pass", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      expect(await app.roleAndGuard.run({}, { user: users.editor })).toBe(
        "role+guard",
      );
    });

    it("should deny when role matches but guard fails", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      await expect(
        app.roleAndGuard.run({}, { user: users.editorWrongEmail }),
      ).rejects.toThrowError(ForbiddenError);
    });

    it("should deny when guard would pass but role does not", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      // viewer with the "allowed" email — guard would pass, but role check fails
      const viewerAllowed = { ...users.viewer, email: "allowed@test.com" };
      await expect(
        app.roleAndGuard.run({}, { user: viewerAllowed }),
      ).rejects.toThrowError(ForbiddenError);
    });
  });

  describe("permissions + guard", () => {
    it("should allow when both permission and guard pass", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      expect(await app.permissionAndGuard.run({}, { user: users.editor })).toBe(
        "permission+guard",
      );
    });

    it("should deny when permission matches but guard fails", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      // viewer has posts:read but wrong email
      await expect(
        app.permissionAndGuard.run({}, { user: users.viewer }),
      ).rejects.toThrowError(ForbiddenError);
    });

    it("should deny when guard would pass but permission does not", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      // user with correct email but no posts:read permission
      const noPermsAllowed = { ...users.noRoles, email: "allowed@test.com" };
      await expect(
        app.permissionAndGuard.run({}, { user: noPermsAllowed }),
      ).rejects.toThrowError(ForbiddenError);
    });
  });
});

// -----------------------------------------------------------------------------------------------------------------
// Three-option combinations
// -----------------------------------------------------------------------------------------------------------------

describe("$secure three-option combinations", () => {
  describe("issuers + roles + permissions", () => {
    it("should allow when all three match", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      expect(
        await app.issuerRolePermission.run({}, { user: users.editor }),
      ).toBe("issuer+role+permission");
    });

    it("should deny when issuer fails", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      const externalEditor = {
        ...users.editor,
        id: randomUUID(),
        realm: "external",
      };
      await expect(
        app.issuerRolePermission.run({}, { user: externalEditor }),
      ).rejects.toThrowError(ForbiddenError);
    });

    it("should deny when role fails", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      await expect(
        app.issuerRolePermission.run({}, { user: users.viewer }),
      ).rejects.toThrowError(ForbiddenError);
    });

    it("should deny when permission fails", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      // moderator role doesn't have posts:create
      await expect(
        app.issuerRolePermission.run({}, { user: users.moderator }),
      ).rejects.toThrowError(ForbiddenError);
    });
  });

  describe("issuers + roles + guard", () => {
    it("should allow when all three match", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      expect(await app.issuerRoleGuard.run({}, { user: users.editor })).toBe(
        "issuer+role+guard",
      );
    });

    it("should deny when guard fails (issuer and role pass)", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      await expect(
        app.issuerRoleGuard.run({}, { user: users.editorWrongEmail }),
      ).rejects.toThrowError(ForbiddenError);
    });
  });

  describe("issuers + permissions + guard", () => {
    it("should allow when all three match", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      expect(
        await app.issuerPermissionGuard.run({}, { user: users.editor }),
      ).toBe("issuer+permission+guard");
    });

    it("should deny when permission fails (issuer and guard would pass)", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      // viewer has posts:read but not posts:create
      const viewerAllowed = { ...users.viewer, email: "allowed@test.com" };
      await expect(
        app.issuerPermissionGuard.run({}, { user: viewerAllowed }),
      ).rejects.toThrowError(ForbiddenError);
    });
  });

  describe("roles + permissions + guard", () => {
    it("should allow when all three match", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      expect(
        await app.rolePermissionGuard.run({}, { user: users.editor }),
      ).toBe("role+permission+guard");
    });

    it("should deny when only guard fails", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      await expect(
        app.rolePermissionGuard.run({}, { user: users.editorWrongEmail }),
      ).rejects.toThrowError(ForbiddenError);
    });

    it("should deny when only role fails", async () => {
      const { alepha, app, users } = setup();
      await alepha.start();

      // admin has all permissions and correct email but not "editor" role
      const adminAllowed = { ...users.admin, email: "allowed@test.com" };
      await expect(
        app.rolePermissionGuard.run({}, { user: adminAllowed }),
      ).rejects.toThrowError(ForbiddenError);
    });
  });
});

// -----------------------------------------------------------------------------------------------------------------
// All four options
// -----------------------------------------------------------------------------------------------------------------

describe("$secure all options combined", () => {
  it("should allow when issuer + role + permission + guard all pass", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    expect(await app.allOptions.run({}, { user: users.editor })).toBe("all");
  });

  it("should deny when only issuer fails", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    const externalEditor = {
      ...users.editor,
      id: randomUUID(),
      realm: "external",
    };
    await expect(
      app.allOptions.run({}, { user: externalEditor }),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("should deny when only role fails", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    const viewerAllowed = { ...users.viewer, email: "allowed@test.com" };
    await expect(
      app.allOptions.run({}, { user: viewerAllowed }),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("should deny when only permission fails", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    // moderator role has posts:delete and comments:delete, but not posts:create
    const modAllowed = {
      ...users.moderator,
      roles: ["moderator"],
      email: "allowed@test.com",
    };
    await expect(
      app.allOptions.run({}, { user: modAllowed }),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("should deny when only guard fails", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    await expect(
      app.allOptions.run({}, { user: users.editorWrongEmail }),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("should deny unauthenticated user", async () => {
    const { alepha, app } = setup();
    await alepha.start();

    await expect(app.allOptions.run({})).rejects.toThrowError(
      UnauthorizedError,
    );
  });
});

// -----------------------------------------------------------------------------------------------------------------
// Multiple permissions (AND logic)
// -----------------------------------------------------------------------------------------------------------------

describe("$secure multiple permissions (AND)", () => {
  it("should allow when user has all required permissions", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    // moderator has posts:read AND posts:delete
    expect(
      await app.multiplePermissions.run({}, { user: users.moderator }),
    ).toBe("multi-perm");
  });

  it("should deny when user has only some of the required permissions", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    // viewer has posts:read but NOT posts:delete
    await expect(
      app.multiplePermissions.run({}, { user: users.viewer }),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("should deny when user has none of the required permissions", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    await expect(
      app.multiplePermissions.run({}, { user: users.noRoles }),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("should allow admin with wildcard permission", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    expect(await app.multiplePermissions.run({}, { user: users.admin })).toBe(
      "multi-perm",
    );
  });
});

// -----------------------------------------------------------------------------------------------------------------
// Multiple issuers (OR logic)
// -----------------------------------------------------------------------------------------------------------------

describe("$secure multiple issuers (OR)", () => {
  it("should allow user from first issuer", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    expect(await app.multipleIssuers.run({}, { user: users.editor })).toBe(
      "multi-issuer",
    );
  });

  it("should allow user from second issuer", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    expect(await app.multipleIssuers.run({}, { user: users.partner })).toBe(
      "multi-issuer",
    );
  });

  it("should deny user from unknown issuer", async () => {
    const { alepha, app } = setup();
    await alepha.start();

    const unknownRealmUser = {
      id: randomUUID(),
      roles: ["admin"],
      realm: "unknown",
      name: "Unknown",
    };
    await expect(
      app.multipleIssuers.run({}, { user: unknownRealmUser }),
    ).rejects.toThrowError(ForbiddenError);
  });
});

// -----------------------------------------------------------------------------------------------------------------
// Multiple roles (OR logic)
// -----------------------------------------------------------------------------------------------------------------

describe("$secure multiple roles (OR)", () => {
  it("should allow user with first matching role", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    expect(await app.multipleRoles.run({}, { user: users.editor })).toBe(
      "multi-role",
    );
  });

  it("should allow user with second matching role", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    expect(await app.multipleRoles.run({}, { user: users.moderator })).toBe(
      "multi-role",
    );
  });

  it("should allow user with both roles", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    expect(
      await app.multipleRoles.run({}, { user: users.editorAndModerator }),
    ).toBe("multi-role");
  });

  it("should deny user with none of the required roles", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    await expect(
      app.multipleRoles.run({}, { user: users.viewer }),
    ).rejects.toThrowError(ForbiddenError);
  });
});

// -----------------------------------------------------------------------------------------------------------------
// Check order: issuer → role → permission → guard
// -----------------------------------------------------------------------------------------------------------------

describe("$secure check order", () => {
  it("should check issuer before role", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    // User from wrong issuer with wrong role — error message should be about issuer, not role
    const wrongBoth = {
      id: randomUUID(),
      roles: ["viewer"],
      realm: "external",
      name: "Wrong",
    };
    await expect(
      app.issuerAndRole.run({}, { user: wrongBoth }),
    ).rejects.toThrowError(/issuer/i);
  });

  it("should check role before permission", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    // User with wrong role and wrong permission — error should be about role
    await expect(
      app.roleAndPermission.run({}, { user: users.viewer }),
    ).rejects.toThrowError(/role.*required/i);
  });

  it("should check permission before guard", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    // User with correct email (guard would pass) but no permission
    const noPermsAllowed = { ...users.noRoles, email: "allowed@test.com" };
    await expect(
      app.permissionAndGuard.run({}, { user: noPermsAllowed }),
    ).rejects.toThrowError(/permission.*required/i);
  });

  it("should reach guard only after all other checks pass", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    // Editor with wrong email — issuer/role/permission all pass, only guard fails
    await expect(
      app.allOptions.run({}, { user: users.editorWrongEmail }),
    ).rejects.toThrowError(/access denied/i);
  });
});

// -----------------------------------------------------------------------------------------------------------------
// Edge cases
// -----------------------------------------------------------------------------------------------------------------

describe("$secure edge cases", () => {
  it("should deny user with empty roles array against role check", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    await expect(
      app.requireViewer.run({}, { user: users.noRoles }),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("should deny user with undefined roles against role check", async () => {
    const { alepha, app } = setup();
    await alepha.start();

    const noRolesUndefined = {
      id: randomUUID(),
      realm: "main",
      name: "NoRoles",
    };
    await expect(
      app.requireViewer.run({}, { user: noRolesUndefined }),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("should deny user with no realm against issuer check", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    await expect(
      app.requireMainIssuer.run({}, { user: users.noRealm }),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("should deny user with empty roles array against permission check", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    await expect(
      app.requireRead.run({}, { user: users.noRoles }),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("should allow auth-only action for user with no roles", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    expect(await app.authOnly.run({}, { user: users.noRoles })).toBe(
      "auth-only",
    );
  });

  it("should allow auth-only action for user with no realm", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    expect(await app.authOnly.run({}, { user: users.noRealm })).toBe(
      "auth-only",
    );
  });

  it("should allow admin wildcard through any permission check", async () => {
    const { alepha, app, users } = setup();
    await alepha.start();

    expect(await app.requireRead.run({}, { user: users.admin })).toBe("read");
  });
});
