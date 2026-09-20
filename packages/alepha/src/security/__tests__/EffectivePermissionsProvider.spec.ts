import { Alepha } from "alepha";
import {
  $issuer,
  $permission,
  AlephaSecurity,
  EffectivePermissionsProvider,
  type UserAccountToken,
} from "alepha/security";
import { describe, expect, it } from "vitest";

/**
 * The application half of an effective permission set: the catalogue, the
 * role grant, the privileged bypass and the permission scope. Everything that
 * narrows further is the application's, and arrives as a predicate.
 */
class Catalogue {
  read = $permission({ group: "staff:quest", name: "read" });
  write = $permission({ group: "staff:quest", name: "write" });
  purge = $permission({ group: "admin:ops", name: "purge" });

  realm = $issuer({
    name: "app",
    secret: "effective-permissions-test-secret!",
    roles: [
      { name: "admin", permissions: [{ name: "*" }] },
      {
        name: "member",
        permissions: [
          { name: "staff:quest:read" },
          { name: "staff:quest:write" },
        ],
      },
      { name: "guest", permissions: [{ name: "staff:quest:read" }] },
    ],
  });
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaSecurity);
  alepha.with(Catalogue);
  await alepha.start();
  return alepha.inject(EffectivePermissionsProvider);
};

const user = (over: Partial<UserAccountToken> = {}): UserAccountToken =>
  ({ id: "u1", realm: "app", roles: ["member"], ...over }) as UserAccountToken;

describe("EffectivePermissionsProvider", () => {
  it("returns what the roles grant, in catalogue order", async () => {
    const provider = await setup();
    expect(provider.resolve({ user: user() })).toEqual([
      "staff:quest:read",
      "staff:quest:write",
    ]);
    expect(provider.resolve({ user: user({ roles: ["guest"] }) })).toEqual([
      "staff:quest:read",
    ]);
  });

  it("applies every narrowing factor, and a factor may only remove", async () => {
    const provider = await setup();
    expect(
      provider.resolve({
        user: user(),
        narrow: [(id) => id !== "staff:quest:write"],
      }),
    ).toEqual(["staff:quest:read"]);

    // A factor that says yes to something the roles refuse does not add it.
    expect(
      provider.resolve({
        user: user({ roles: ["guest"] }),
        narrow: [() => true],
      }),
    ).toEqual(["staff:quest:read"]);
  });

  it("intersects several factors", async () => {
    const provider = await setup();
    expect(
      provider.resolve({
        user: user(),
        narrow: [() => true, (id) => id.endsWith(":read")],
      }),
    ).toEqual(["staff:quest:read"]);
  });

  it("excludes prefixes from the catalogue entirely", async () => {
    const provider = await setup();
    const admin = user({ roles: ["admin"] });
    expect(provider.resolve({ user: admin })).toContain("admin:ops:purge");
    expect(
      provider.resolve({ user: admin, exclude: ["admin:"] }),
    ).not.toContain("admin:ops:purge");
  });

  it("lets a privileged identity past the application's factors", async () => {
    const provider = await setup();
    const operator = user({ ownership: false, roles: [] });
    // No role grant at all, and a factor that refuses everything.
    expect(provider.resolve({ user: operator, narrow: [() => false] })).toEqual(
      ["staff:quest:read", "staff:quest:write", "admin:ops:purge"],
    );
  });

  it("still applies a permission scope to a privileged identity", async () => {
    const provider = await setup();
    const scoped = user({
      ownership: false,
      roles: [],
      permissionScope: ["staff:quest:read"],
    });
    expect(provider.resolve({ user: scoped, narrow: [() => false] })).toEqual([
      "staff:quest:read",
    ]);
  });

  it("honours exclude for a privileged identity too", async () => {
    const provider = await setup();
    const operator = user({ ownership: false, roles: [] });
    expect(
      provider.resolve({ user: operator, exclude: ["admin:"] }),
    ).not.toContain("admin:ops:purge");
  });
});
