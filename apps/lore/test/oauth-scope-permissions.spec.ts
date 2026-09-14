import { Alepha } from "alepha";
import { oauthOptions } from "alepha/api/oauth";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, SecurityProvider } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterAll, beforeAll, describe, it } from "vitest";

import { LoreApi } from "../src/api/index.ts";
import { LoreOAuthScopes } from "../src/api/security/LoreOAuthScopes.ts";
import { LoreMcp } from "../src/mcp/index.ts";

/**
 * Lore's OAuth scope declarations against the permission registry Lore
 * actually boots with: the framework's modules and Lore's own, together.
 *
 * The lists in `LoreOAuthScopes` are written out, so this is what keeps them
 * true. A group added later fails here until somebody decides whether a
 * connected app reaches it.
 */
describe("Lore's OAuth scopes", () => {
  let alepha: Alepha;
  let security: SecurityProvider;
  let permissions: string[];

  beforeAll(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha
      .with(AlephaOrm)
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaEmail)
      .with(AlephaApiUsers)
      .with(AlephaMcp);
    // As `main.server.ts` does it, before the `$realm` in `LoreApi`.
    alepha.set(oauthOptions, {
      realm: "users",
      resource: "/mcp",
      loginPath: "/auth/login",
      scopes: LoreOAuthScopes.SCOPES,
    });
    alepha.with(LoreApi).with(LoreMcp);
    await alepha.start();

    security = alepha.inject(SecurityProvider);
    permissions = security
      .permissionCatalogueFor()
      .groups.flatMap((group) => group.permissions.map((it) => it.name));
  });

  afterAll(async () => {
    await alepha.stop();
  });

  const groupOf = (permission: string) => permission.split(":")[0];

  /**
   * Catalogue groups that name no permission a route checks.
   *
   * `AdminAvatarController` declares `$permission({ name: "admin:user:avatar" })`,
   * which the registry files under the declaring class, as
   * `AdminAvatarController:admin:user:avatar`; its routes check the real
   * `admin:user:avatar`, registered beside it. Listed so the placement test
   * reads the registry honestly, and still asserted out of every scope.
   */
  const MISFILED_GROUPS = new Set(["AdminAvatarController"]);

  const reaches = (scope: string, permission: string) =>
    security.isInPermissionScope(
      permission,
      LoreOAuthScopes.SCOPES[scope].permissions,
    );

  it("places every registered permission group: a member group, admin, or left out", ({
    expect,
  }) => {
    const unplaced = [
      ...new Set(
        permissions
          .map(groupOf)
          .filter(
            (group) =>
              group !== "admin" &&
              !MISFILED_GROUPS.has(group) &&
              !LoreOAuthScopes.MEMBER_GROUPS.includes(group) &&
              !LoreOAuthScopes.EXCLUDED_GROUPS.includes(group),
          ),
      ),
    ];

    expect(
      unplaced,
      "a new permission group: add it to LoreOAuthScopes.MEMBER_GROUPS or EXCLUDED_GROUPS",
    ).toEqual([]);
  });

  it("lists no member group the registry does not have", ({ expect }) => {
    const registered = new Set(permissions.map(groupOf));

    expect(
      LoreOAuthScopes.MEMBER_GROUPS.filter((group) => !registered.has(group)),
    ).toEqual([]);
  });

  it("lets mcp and cli reach every member permission", ({ expect }) => {
    const member = permissions.filter((permission) =>
      LoreOAuthScopes.MEMBER_GROUPS.includes(groupOf(permission)),
    );
    expect(member.length).toBeGreaterThan(0);

    for (const scope of ["mcp", "cli"]) {
      expect(
        member.filter((permission) => !reaches(scope, permission)),
        scope,
      ).toEqual([]);
    }
  });

  it("keeps mcp and cli out of every admin and left-out permission", ({
    expect,
  }) => {
    const outside = permissions.filter(
      (permission) =>
        permission.startsWith("admin:") ||
        MISFILED_GROUPS.has(groupOf(permission)) ||
        LoreOAuthScopes.EXCLUDED_GROUPS.includes(groupOf(permission)),
    );
    expect(outside.some((it) => it.startsWith("admin:"))).toBe(true);
    expect(outside).toContain("api-key:read");

    for (const scope of ["mcp", "cli"]) {
      expect(
        outside.filter((permission) => reaches(scope, permission)),
        scope,
      ).toEqual([]);
    }
  });

  it("gives openid nothing, and declares permissions on every scope so none boots unrestricted", ({
    expect,
  }) => {
    expect(permissions.filter((it) => reaches("openid", it))).toEqual([]);

    for (const [id, scope] of Object.entries(LoreOAuthScopes.SCOPES)) {
      expect(Array.isArray(scope.permissions), id).toBe(true);
    }
  });
});
