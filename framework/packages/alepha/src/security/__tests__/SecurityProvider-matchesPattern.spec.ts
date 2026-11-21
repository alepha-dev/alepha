import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { $issuer, $secure } from "../index.ts";
import { SecurityProvider } from "../providers/SecurityProvider.ts";
import type { Role } from "../schemas/roleSchema.ts";

/**
 * Exposes the protected matcher shared by role grants, their excludes and
 * permission scopes.
 */
class TestSecurityProvider extends SecurityProvider {
  public testMatchesPattern = this.matchesPattern.bind(this);
}

describe("SecurityProvider.matchesPattern", () => {
  const matcher = () =>
    Alepha.create()
      .with({ provide: SecurityProvider, use: TestSecurityProvider })
      .inject(TestSecurityProvider).testMatchesPattern;

  it("matches everything with '*'", ({ expect }) => {
    const matches = matcher();

    expect(matches("docs:read", "*")).toBe(true);
    expect(matches("standalone", "*")).toBe(true);
  });

  it("matches an exact string and nothing else", ({ expect }) => {
    const matches = matcher();

    expect(matches("docs:read", "docs:read")).toBe(true);
    expect(matches("docs:read", "docs:write")).toBe(false);
    expect(matches("docs:reader", "docs:read")).toBe(false);
  });

  it("matches 'prefix:*' at any depth", ({ expect }) => {
    const matches = matcher();

    expect(matches("admin:read", "admin:*")).toBe(true);
    expect(matches("admin:api:users:read", "admin:*")).toBe(true);
    expect(matches("admin:api:users:read", "admin:api:*")).toBe(true);
  });

  it("does not match the bare prefix with 'prefix:*'", ({ expect }) => {
    const matches = matcher();

    expect(matches("admin", "admin:*")).toBe(false);
    expect(matches("admin:api", "admin:api:*")).toBe(false);
  });

  it("does not match a sibling that only shares leading characters", ({
    expect,
  }) => {
    const matches = matcher();

    expect(matches("administrator:read", "admin:*")).toBe(false);
  });

  it("treats a wildcard on the permission as a literal, never as a pattern", ({
    expect,
  }) => {
    // The scope direction: the wildcard belongs to the grant. A concrete
    // grant of `docs:read` must not satisfy a requirement spelled `docs:*`.
    const matches = matcher();

    expect(matches("docs:*", "docs:read")).toBe(false);
  });
});

describe("the listing and the check share the matcher", () => {
  const setup = async (role: Role) => {
    class App {
      declared = $secure({
        permissions: ["a:read", "b:read", "b:deep:read", "b"],
      });
      realm = $issuer({ name: "app", secret: "s", roles: [role] });
    }

    const alepha = Alepha.create();
    alepha.inject(App);
    await alepha.start();

    const security = alepha.inject(SecurityProvider);
    const all = ["a:read", "b:read", "b:deep:read", "b"];

    return {
      listed: security
        .getPermissions({ roles: [role.name], realm: "app" })
        .map((it) => security.permissionToString(it))
        .sort(),
      checked: all
        .filter(
          (it) =>
            security.checkPermissionInRealm("app", it, role.name).isAuthorized,
        )
        .sort(),
    };
  };

  it("lists nothing for a grant whose exclude is '*'", async ({ expect }) => {
    const { listed, checked } = await setup({
      name: "none",
      permissions: [{ name: "*", exclude: ["*"] }],
    });

    expect(checked).toEqual([]);
    expect(listed).toEqual(checked);
  });

  it("lists what the check allows for a 'prefix:*' exclude, bare prefix included", async ({
    expect,
  }) => {
    const { listed, checked } = await setup({
      name: "most",
      permissions: [{ name: "*", exclude: ["b:*"] }],
    });

    expect(checked).toEqual(["a:read", "b"]);
    expect(listed).toEqual(checked);
  });
});
