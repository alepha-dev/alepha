import { $pipeline, Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { currentUserAtom } from "../atoms/currentUserAtom.ts";
import { $role, $secure, SecurityProvider } from "../index.ts";
import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";

class Roles {
  editor = $role({
    name: "editor",
    permissions: [
      { name: "docs:read", ownership: true }, // own rows only
      { name: "docs:list" },
      { name: "docs:write" },
      { name: "admin:api:*" },
    ],
  });

  admin = $role({
    name: "admin",
    permissions: [{ name: "*" }],
  });
}

class Permissions {
  // Register concrete permissions so getPermissions has something to expand.
  fn = $pipeline({
    use: [
      $secure({
        permissions: [
          "docs:read",
          "docs:list",
          "docs:write",
          "admin:api:users:read",
          "admin:api:keys:read",
          "billing:read",
        ],
      }),
    ],
    handler: async () => true,
  });
}

const setup = async () => {
  const alepha = Alepha.create();
  alepha.inject(Roles);
  alepha.inject(Permissions);
  const security = alepha.inject(SecurityProvider);
  await alepha.start();
  return { alepha, security };
};

const names = (security: SecurityProvider, user: Partial<UserAccountToken>) =>
  security
    .getPermissions(user)
    .map((it) => security.permissionToString(it))
    .sort();

describe("permissionScope", () => {
  describe("SecurityProvider.checkUserPermission", () => {
    it("allows what the roles grant when the scope is undefined", async () => {
      const { security } = await setup();
      const user = { id: "u", realm: "default", roles: ["editor"] };

      expect(
        security.checkUserPermission(user, "docs:write").isAuthorized,
      ).toBe(true);
    });

    it("denies everything when the scope is empty, even with a '*' role", async () => {
      const { security } = await setup();

      const editor = {
        roles: ["editor"],
        realm: "default",
        permissionScope: [],
      };
      const admin = { roles: ["admin"], realm: "default", permissionScope: [] };

      const refused = security.checkUserPermission(editor, "docs:list");
      expect(refused.isAuthorized).toBe(false);
      expect(refused.deniedBy).toBe("scope");
      expect(
        security.checkUserPermission(admin, "docs:list").isAuthorized,
      ).toBe(false);
    });

    it("allows only what a non-empty scope matches", async () => {
      const { security } = await setup();
      const user = {
        roles: ["editor"],
        realm: "default",
        permissionScope: ["docs:list"],
      };

      expect(security.checkUserPermission(user, "docs:list").isAuthorized).toBe(
        true,
      );
      const refused = security.checkUserPermission(user, "docs:write");
      expect(refused.isAuthorized).toBe(false);
      expect(refused.deniedBy).toBe("scope");
    });

    it("never widens: a scope entry the roles do not grant is still refused, by the roles", async () => {
      const { security } = await setup();
      const user = {
        roles: ["editor"],
        realm: "default",
        permissionScope: ["billing:read"],
      };

      const refused = security.checkUserPermission(user, "billing:read");
      expect(refused.isAuthorized).toBe(false);
      expect(refused.deniedBy).toBe("roles");
    });

    it("matches a wildcard scope entry against a permission in a sub-group", async () => {
      const { security } = await setup();
      const user = {
        roles: ["admin"],
        realm: "default",
        permissionScope: ["admin:api:*"],
      };

      expect(
        security.checkUserPermission(user, "admin:api:users:read").isAuthorized,
      ).toBe(true);
      expect(security.checkUserPermission(user, "docs:read").isAuthorized).toBe(
        false,
      );
    });

    it("keeps the roles' ownership answer when the scope admits the permission", async () => {
      const { security } = await setup();
      const scoped = {
        roles: ["editor"],
        realm: "default",
        permissionScope: ["docs:read", "docs:list"],
      };

      expect(security.checkUserPermission(scoped, "docs:read").ownership).toBe(
        true,
      );
      expect(security.checkUserPermission(scoped, "docs:list").ownership).toBe(
        false,
      );
    });
  });

  describe("SecurityProvider.createUser", () => {
    it("carries the scope onto the token, and checks a requested permission against it", async () => {
      const { alepha, security } = await setup();

      const user = security.createUser(
        { id: "u", roles: ["editor"], permissionScope: [] },
        { realm: "default" },
      );
      expect(user.permissionScope).toEqual([]);

      // Survives the schema decode that publishes the user to the context.
      await alepha.context.run(async () => {
        security.storeUserInContext(user);
        expect(alepha.store.get(currentUserAtom)?.permissionScope).toEqual([]);
      });

      expect(() =>
        security.createUser(
          { id: "u", roles: ["editor"], permissionScope: ["docs:list"] },
          { realm: "default", permission: "docs:write" },
        ),
      ).toThrow("not allowed");
    });
  });

  describe("SecurityProvider.getPermissions", () => {
    it("returns the roles' permissions unchanged when the scope is undefined", async () => {
      const { security } = await setup();

      expect(names(security, { roles: ["editor"], realm: "default" })).toEqual([
        "admin:api:keys:read",
        "admin:api:users:read",
        "docs:list",
        "docs:read",
        "docs:write",
      ]);
    });

    it("returns the intersection for a scoped user", async () => {
      const { security } = await setup();

      expect(
        names(security, {
          roles: ["editor"],
          realm: "default",
          permissionScope: ["docs:list", "admin:api:*", "billing:read"],
        }),
      ).toEqual(["admin:api:keys:read", "admin:api:users:read", "docs:list"]);
    });

    it("intersects a '*' role too, and an empty scope leaves nothing", async () => {
      const { security } = await setup();

      expect(
        names(security, {
          roles: ["admin"],
          realm: "default",
          permissionScope: ["billing:read"],
        }),
      ).toEqual(["billing:read"]);
      expect(
        names(security, {
          roles: ["admin"],
          realm: "default",
          permissionScope: [],
        }),
      ).toEqual([]);
    });
  });

  describe("$secure", () => {
    const run = async (
      user: UserAccountToken,
      secure: Parameters<typeof $secure>[0],
    ) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure(secure)],
          handler: async () => alepha.store.get(currentUserAtom)?.ownership,
        });
      }

      alepha.inject(Roles);
      const app = alepha.inject(App);
      await alepha.start();

      try {
        return await alepha.context.run(async () => {
          alepha.store.set(currentUserAtom, user);
          return app.fn();
        });
      } finally {
        await alepha.stop();
      }
    };

    const scoped: UserAccountToken = {
      id: "u1",
      realm: "default",
      roles: ["editor"],
      permissionScope: ["docs:read"],
    };

    it("refuses a permission the roles grant when the scope excludes it, saying so", async () => {
      await expect(
        run(scoped, { permissions: ["docs:write"] }),
      ).rejects.toThrow("outside this credential's permission scope");
    });

    it("keeps the role message when the roles refuse", async () => {
      await expect(
        run(scoped, { permissions: ["billing:read"] }),
      ).rejects.toThrow("Permission 'billing:read' required");
    });

    it("admits a scoped caller on a route that declares no permission (D8)", async () => {
      // Pinned on purpose: a scope narrows what a credential may DO, not what
      // it may SEE. Tightening this is a decision, not a fix.
      const empty: UserAccountToken = { ...scoped, permissionScope: [] };

      await expect(run(empty, undefined)).resolves.toBeUndefined();
      await expect(run(empty, { roles: ["editor"] })).resolves.toBeUndefined();
    });

    it("resolves ownership exactly as without a scope, in either order", async () => {
      const both: UserAccountToken = {
        ...scoped,
        permissionScope: ["docs:read", "docs:list"],
      };

      expect(await run(both, { permissions: ["docs:read", "docs:list"] })).toBe(
        true,
      );
      expect(await run(both, { permissions: ["docs:list", "docs:read"] })).toBe(
        true,
      );
      expect(await run(both, { permissions: ["docs:list"] })).toBe(false);
    });
  });
});
