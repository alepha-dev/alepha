import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { $issuer, JwtProvider, SecurityProvider } from "../index.ts";

class App {
  plain = $issuer({
    name: "plain",
    secret: "plain-secret-plain-secret-plain!",
  });

  profiled = $issuer({
    name: "profiled",
    secret: "profiled-secret-profiled-secret!",
    // A profile mapping written before the credential marker existed.
    profile: (payload) => ({ id: String(payload.sub), roles: [] }),
  });
}

const setup = async () => {
  const alepha = Alepha.create();
  const app = alepha.inject(App);
  await alepha.start();
  return {
    app,
    security: alepha.inject(SecurityProvider),
    jwt: alepha.inject(JwtProvider),
  };
};

describe("the credential marker from an access token", () => {
  it("maps a realm token's client_id claim to an oauth credential", async () => {
    const { security } = await setup();

    const account = security.createUserFromPayload(
      { sub: "u1", client_id: "connected-app" },
      "plain",
    );

    expect(account.credential).toEqual({
      type: "oauth",
      clientId: "connected-app",
    });
    expect(security.isMachineCredential(account)).toBe(true);
  });

  it("leaves a session token unmarked", async () => {
    const { security } = await setup();

    const account = security.createUserFromPayload({ sub: "u1" }, "plain");

    expect(account.credential).toBeUndefined();
    expect(security.isMachineCredential(account)).toBe(false);
  });

  it("does not interpret an external identity provider's claims", async () => {
    // Called without a realm, the payload is a third-party profile (an OIDC
    // id_token, a userinfo response), whose `client_id` is not ours.
    const { security } = await setup();

    const account = security.createUserFromPayload({
      sub: "u1",
      client_id: "someone-elses-client",
    });

    expect(account.credential).toBeUndefined();
  });

  it("marks the identity even through a realm's custom profile mapping", async () => {
    const { security } = await setup();

    const account = security.createUserFromPayload(
      { sub: "u1", client_id: "connected-app" },
      "profiled",
    );

    expect(account.credential).toEqual({
      type: "oauth",
      clientId: "connected-app",
    });
  });

  it("keeps client_id through a token-only refresh, with no session store", async () => {
    const { app, jwt } = await setup();

    const first = await app.plain.createToken(
      { id: "u1", roles: [] },
      undefined,
      { clientId: "connected-app" },
    );
    const { tokens } = await app.plain.refreshToken(
      first.refresh_token!,
      first.access_token,
    );

    const { result } = await jwt.parse(tokens.access_token, "plain");
    expect(result.payload.client_id).toBe("connected-app");
  });

  it("signs no client_id into a token minted for a person", async () => {
    const { app, jwt } = await setup();

    const tokens = await app.plain.createToken({ id: "u1", roles: [] });

    const { result } = await jwt.parse(tokens.access_token, "plain");
    expect(result.payload.client_id).toBeUndefined();
  });
});
