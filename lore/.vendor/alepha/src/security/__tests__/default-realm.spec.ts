import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { $issuer, AlephaSecurity, SecurityProvider } from "../index.ts";

/**
 * Which realm a realm-less lookup resolves against used to be POSITIONAL:
 * `realms[0]`, so the order of fields in a class decided it, and nothing
 * declared or checked that. It cost a verified user their access - an
 * application declared its staff realm first (as a workaround for the
 * cross-realm token bug, #1705) and a citizen holding `citizen` in their user
 * row was then refused `citizen:apply`, because the role was resolved among
 * staff roles.
 *
 * The answer now comes from a declaration, and from nothing else:
 *
 * - one realm: that realm, since there is nothing to be ambiguous about;
 * - several, one marked `default: true`: that one;
 * - several, none marked: refused, so the caller that forgot to pass a realm
 *   fails AT THE CALL rather than silently resolving the wrong set.
 *
 * Refusing exactly from the second realm on is the same rule as
 * `JwtProvider.matchesRealmAudience`, for the same reason.
 */
describe("the realm a realm-less lookup resolves against", () => {
  const boot = async (App: new () => any) => {
    const alepha = Alepha.create().with(AlephaSecurity);
    alepha.inject(App);
    await alepha.start();
    return alepha.inject(SecurityProvider);
  };

  it("is the only realm when there is one", async ({ expect }) => {
    class App {
      citizens = $issuer({
        secret: "s",
        roles: [{ name: "user", permissions: [{ name: "citizen:apply" }] }],
      });
    }

    const sec = await boot(App);

    expect(sec.getRealm().name).toBe("citizens");
    expect(sec.checkPermission("citizen:apply", "user").isAuthorized).toBe(
      true,
    );
  });

  it("is the declared one when there are several", async ({ expect }) => {
    class App {
      // Declared FIRST and deliberately not the default: under the old
      // positional rule this realm answered, which is the whole fault.
      staff = $issuer({
        secret: "s1",
        roles: [{ name: "user", permissions: [{ name: "staff:handle" }] }],
      });

      citizens = $issuer({
        secret: "s2",
        default: true,
        roles: [{ name: "user", permissions: [{ name: "citizen:apply" }] }],
      });
    }

    const sec = await boot(App);

    expect(sec.getRealm().name).toBe("citizens");
    expect(sec.checkPermission("citizen:apply", "user").isAuthorized).toBe(
      true,
    );
    expect(sec.checkPermission("staff:handle", "user").isAuthorized).toBe(
      false,
    );
  });

  it("is refused when several realms name no default", async ({ expect }) => {
    class App {
      staff = $issuer({ secret: "s1", roles: [] });
      citizens = $issuer({ secret: "s2", roles: [] });
    }

    const sec = await boot(App);

    // The message has to say what to do, because the caller reading it is
    // several frames away from the omission.
    expect(() => sec.getRealm()).toThrow(/default: true/);
    expect(() => sec.getRealm()).toThrow(/staff, citizens/);
  });

  it("is refused when several realms all claim to be the default", async ({
    expect,
  }) => {
    class App {
      staff = $issuer({ secret: "s1", default: true, roles: [] });
      citizens = $issuer({ secret: "s2", default: true, roles: [] });
    }

    const sec = await boot(App);

    expect(() => sec.getRealm()).toThrow(/Exactly one may be/);
  });

  it("still resolves a realm named on the caller, declared or not", async ({
    expect,
  }) => {
    class App {
      staff = $issuer({
        secret: "s1",
        roles: [{ name: "user", permissions: [{ name: "staff:handle" }] }],
      });

      citizens = $issuer({
        secret: "s2",
        default: true,
        roles: [{ name: "user", permissions: [{ name: "citizen:apply" }] }],
      });
    }

    const sec = await boot(App);

    // A declared realm answers with its own roles.
    expect(
      sec.checkPermissionInRealm("staff", "staff:handle", "user").isAuthorized,
    ).toBe(true);

    // A name no $issuer declared is the realm-less case wearing a name -
    // `alepha/api/users` stamps per-tenant realm names on an account without
    // creating a security realm for each - so it lands on the DECLARED
    // default rather than being refused or scanning every realm.
    expect(
      sec.checkPermissionInRealm("tenant-42", "citizen:apply", "user")
        .isAuthorized,
    ).toBe(true);
    expect(
      sec.checkPermissionInRealm("tenant-42", "staff:handle", "user")
        .isAuthorized,
    ).toBe(false);
  });
});
