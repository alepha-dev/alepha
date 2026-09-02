import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { $issuer, AlephaSecurity, SecurityProvider } from "../index.ts";

/**
 * `createRealm` drops the placeholder realm the provider invents for a test
 * container, so an application's own realms are the only ones registered.
 *
 * It used to recognise that placeholder BY NAME (`realms[0].name ===
 * "default"`), which made an application realm called `default`
 * indistinguishable from it: declaring a second realm silently threw the
 * first one away. Nothing failed at boot. The failure surfaced far from its
 * cause, as a 500 at token minting reading `No secret key found in the
 * keystore`, because the discarded realm never had its signing key
 * registered.
 *
 * `default` is the natural name for an application to pick, since
 * `DEFAULT_USER_REALM_NAME` is what every realm-less `UserService` call falls
 * back to.
 */
describe("a realm named `default` is not the provider's placeholder", () => {
  const roles = [{ name: "user", permissions: [{ name: "*" }] }];

  class App {
    default = $issuer({ secret: "secret-default", roles });
    staff = $issuer({ secret: "secret-staff", roles });
  }

  const boot = async () => {
    const alepha = Alepha.create().with(AlephaSecurity);
    const app = alepha.inject(App);
    await alepha.start();
    return { alepha, app };
  };

  it("keeps both realms registered", async ({ expect }) => {
    const { alepha } = await boot();

    const names = alepha
      .inject(SecurityProvider)
      .getRealms()
      .map((realm) => realm.name);

    expect(names).toContain("default");
    expect(names).toContain("staff");
    expect(names).toHaveLength(2);
  });

  it("mints a token in each, so both signing keys were registered", async ({
    expect,
  }) => {
    const { app } = await boot();
    const user = { id: randomUUID(), roles: ["user"] };

    // The `No secret key found in the keystore` 500 was thrown here, by the
    // realm that had been popped.
    const first = await app.default.createToken(user);
    const second = await app.staff.createToken(user);

    const audOf = (token: string) =>
      JSON.parse(Buffer.from(token.split(".")[1], "base64").toString()).aud;

    expect(audOf(first.access_token)).toBe("default");
    expect(audOf(second.access_token)).toBe("staff");
  });

  it("still drops the placeholder when the app declares its own realms", async ({
    expect,
  }) => {
    // The behaviour the name check was there for, unchanged: a test container
    // starts with an invented realm and must not keep it once an application
    // declares one.
    class OneRealm {
      citizens = $issuer({ secret: "secret-citizens", roles });
    }

    const alepha = Alepha.create().with(AlephaSecurity);
    alepha.inject(OneRealm);
    await alepha.start();

    expect(
      alepha
        .inject(SecurityProvider)
        .getRealms()
        .map((realm) => realm.name),
    ).toEqual(["citizens"]);
  });
});
