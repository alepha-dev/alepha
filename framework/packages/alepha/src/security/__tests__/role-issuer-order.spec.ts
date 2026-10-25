import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { $issuer, $role, SecurityProvider } from "../index.ts";

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
  const bootError = async (alepha: Alepha): Promise<string> => {
    const error: any = await alepha.start().then(
      () => undefined,
      (e) => e,
    );
    expect(error, "expected the boot to fail").toBeDefined();
    return `${error.message} ${error.cause?.message ?? ""}`;
  };

  it("attaches a role declared BEFORE its issuer", async () => {
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

  it("attaches a role declared AFTER its issuer", async () => {
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

  it("fails the boot when a role names a realm nobody declared", async () => {
    const alepha = Alepha.create();
    const sec = alepha.inject(SecurityProvider);
    sec.createRole({ name: "operator", permissions: [] }, "noop");

    expect(await bootError(alepha)).toMatch(/'noop'/);
  });

  it("resolves an issuer's string role reference", async () => {
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

  it("fails the boot when an issuer names a role nobody declared", async () => {
    class Issuers {
      main = $issuer({ secret: "s", roles: ["ghost"] });
    }

    const alepha = Alepha.create();
    alepha.inject(Issuers);

    expect(await bootError(alepha)).toMatch(/'ghost'/);
  });
});
