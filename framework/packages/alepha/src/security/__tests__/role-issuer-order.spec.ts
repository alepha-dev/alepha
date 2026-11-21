import { Alepha } from "alepha";
import { describe, type ExpectStatic, it } from "vitest";

import { $issuer, $role, $secure, SecurityProvider } from "../index.ts";

/**
 * `$role` and `$issuer` are class fields, so which one runs first is decided
 * by whichever class the container instantiates first - nothing the declaring
 * code controls.
 *
 * A role used to be pushed into the realms that happened to exist at that
 * instant. Declared before its issuer it landed in no realm at all; under
 * test it was worse, landing in the implicit `default` realm that
 * `createRealm` then popped. Either way, silently: the role granted nothing
 * and nobody was told.
 *
 * The mirror image was `$issuer({ roles: ["admin"] })`, which resolved its
 * names against a realm created on the next line - empty by construction, so
 * the string form could only ever throw "Role not found".
 */
describe("$role / $issuer declaration order", () => {
  /**
   * The whole message chain of a failed boot. A `ready` hook's throw is
   * wrapped by the event manager, so the message that names the offending
   * declaration is on `cause`.
   */
  const bootError = async (
    alepha: Alepha,
    expect: ExpectStatic,
  ): Promise<string> => {
    const error: any = await alepha.start().then(
      () => undefined,
      (e) => e,
    );
    expect(error, "expected the boot to fail").toBeDefined();
    return `${error.message} ${error.cause?.message ?? ""}`;
  };

  it("attaches a role declared BEFORE its issuer", async ({ expect }) => {
    class Roles {
      editor = $role({ permissions: ["doc:read"] });
    }
    class Issuers {
      main = $issuer({ secret: "s" });
    }

    const alepha = Alepha.create();
    alepha.inject(Roles);
    alepha.inject(Issuers);
    await alepha.start();

    const sec = alepha.inject(SecurityProvider);
    expect(sec.getRoles("main").map((it) => it.name)).toContain("editor");
  });

  it("attaches a role declared AFTER its issuer", async ({ expect }) => {
    class Issuers {
      main = $issuer({ secret: "s" });
    }
    class Roles {
      editor = $role({ permissions: ["doc:read"] });
    }

    const alepha = Alepha.create();
    alepha.inject(Issuers);
    alepha.inject(Roles);
    await alepha.start();

    const sec = alepha.inject(SecurityProvider);
    expect(sec.getRoles("main").map((it) => it.name)).toContain("editor");
  });

  it("fails the boot when a role names a realm nobody declared", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const sec = alepha.inject(SecurityProvider);
    sec.createRole({ name: "operator", permissions: [] }, "noop");

    expect(await bootError(alepha, expect)).toMatch(/'noop'/);
  });

  it("resolves an issuer's string role reference", async ({ expect }) => {
    class Issuers {
      main = $issuer({ secret: "s", roles: ["editor"] });
    }
    class Roles {
      editor = $role({ permissions: ["doc:read"] });
    }

    const alepha = Alepha.create();
    // Issuer first, so the name cannot possibly be resolved eagerly.
    alepha.inject(Issuers);
    alepha.inject(Roles);
    await alepha.start();

    const sec = alepha.inject(SecurityProvider);
    expect(sec.getRoles("main").map((it) => it.name)).toContain("editor");
  });

  it("fails the boot when an issuer names a role nobody declared", async ({
    expect,
  }) => {
    class Issuers {
      main = $issuer({ secret: "s", roles: ["ghost"] });
    }

    const alepha = Alepha.create();
    alepha.inject(Issuers);

    expect(await bootError(alepha, expect)).toMatch(/'ghost'/);
  });

  it("applies a role reference to the realm that replaces the placeholder of the same name", ({
    expect,
  }) => {
    // A test container starts with a placeholder realm named `default`.
    const alepha = Alepha.create();
    const sec = alepha.inject(SecurityProvider);

    sec.createRole({ name: "editor", permissions: [] }, "nowhere");
    sec.referenceRole("default", "editor");
    sec.createRealm({ name: "default", roles: [] });

    expect(sec.getRoles("default").map((it) => it.name)).toEqual(["editor"]);
  });

  describe("roles replaced at runtime", () => {
    const setup = async () => {
      class App {
        declared = $secure({ permissions: ["a:read"] });
        realm = $issuer({ name: "app", secret: "s", roles: ["named"] });
        admin = $role({ name: "admin", permissions: ["*"] });
        viewer = $role({ name: "viewer", permissions: ["a:read"] });
        named = $role({ name: "named", permissions: ["a:read"] });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      return { app, sec: alepha.inject(SecurityProvider) };
    };

    it("keeps a removed role removed when another role is declared later", async ({
      expect,
    }) => {
      const { app, sec } = await setup();
      expect(
        sec
          .getRoles("app")
          .map((it) => it.name)
          .sort(),
      ).toEqual(["admin", "named", "viewer"]);

      await app.realm.setRoles([
        { name: "viewer", permissions: [{ name: "a:read" }] },
      ]);
      sec.createRole(
        { name: "extra", permissions: [{ name: "a:read" }] },
        "app",
      );

      // Neither `admin` nor `named` comes back, and `viewer` is listed once.
      expect(sec.getRoles("app").map((it) => it.name)).toEqual([
        "viewer",
        "extra",
      ]);
      expect(() =>
        sec.checkPermissionInRealm("app", "a:read", "admin"),
      ).toThrow("Role 'admin' not found");
    });

    it("keeps a removed role removed when a role reference is recorded later", async ({
      expect,
    }) => {
      const { sec } = await setup();

      await sec.updateRealm("app", []);
      sec.referenceRole("app", "viewer");

      expect(sec.getRoles("app")).toEqual([]);
    });
  });
});
