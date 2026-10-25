import { createHash, randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { OAuthClientService } from "alepha/api/oauth";
import { AlephaEmail } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity, JwtProvider } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { $realm, AlephaApiUsers, RealmProvider } from "../index.ts";

/**
 * D10 for connected apps: the access token a client obtains through the OAuth
 * authorization server is a machine credential, like an API key. It carries a
 * `client_id` claim from creation and through every refresh, and routes that
 * need a signed-in session refuse it.
 */
class TestApp {
  realm = $realm({ features: { apiKeys: true, oauth: true } });
}

const SESSION_REQUIRED = "requires a signed-in session";

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaServer)
    .with(AlephaOrmPostgres)
    .with(AlephaSecurity)
    .with(AlephaEmail)
    .with(AlephaApiUsers);
  const app = alepha.inject(TestApp);
  await alepha.start();

  const { hostname } = alepha.inject(ServerProvider);
  const oauth = alepha.inject(OAuthClientService);
  const jwt = alepha.inject(JwtProvider);

  const username = `d10-oauth-${randomUUID().slice(0, 8)}`;
  const user = await alepha
    .inject(RealmProvider)
    .userRepository()
    .create({ username, email: `${username}@example.com`, roles: ["user"] });

  const redirectUri = "https://connected.example.com/callback";
  const client = await oauth.register({
    realm: "users",
    clientName: "Connected App",
    redirectUris: [redirectUri],
    scopes: ["openid"],
  });

  const token = async (body: Record<string, string>) => {
    const response = await fetch(`${hostname}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, string>;
  };

  /**
   * A full authorization_code exchange, as a connected app performs it.
   */
  const codeGrant = async () => {
    const verifier = `verifier-${randomUUID()}`;
    const code = await oauth.createAuthorizationCode("users", {
      userId: user.id,
      clientId: client.clientId,
      redirectUri,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      scopes: ["openid"],
    });
    return token({
      grant_type: "authorization_code",
      code,
      client_id: client.clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
  };

  const call = (method: string, path: string, bearer: string, body?: unknown) =>
    fetch(`${hostname}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${bearer}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  const expectRefused = async (bearer: string) => {
    for (const [method, path, body] of [
      ["PATCH", "/api/users/me", { firstName: "Connected" }],
      ["POST", "/api/api-keys", { name: `by-app-${randomUUID()}` }],
    ] as const) {
      const response = await call(method, path, bearer, body);
      expect(response.status).toBe(403);
      expect(await response.text()).toContain(SESSION_REQUIRED);
    }
  };

  return { app, jwt, user, client, token, codeGrant, call, expectRefused };
};

describe("an OAuth access token is not a session", () => {
  it("carries client_id from the code grant, and is refused session-only routes", async () => {
    const { jwt, client, codeGrant, expectRefused } = await setup();

    const tokens = await codeGrant();
    const { result } = await jwt.parse(tokens.access_token, "users");
    expect(result.payload.client_id).toBe(client.clientId);

    await expectRefused(tokens.access_token);
  });

  it("keeps client_id through a refresh at /oauth/token", async () => {
    const { jwt, client, token, codeGrant, expectRefused } = await setup();

    const first = await codeGrant();
    const refreshed = await token({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id: client.clientId,
    });

    const { result } = await jwt.parse(refreshed.access_token, "users");
    expect(result.payload.client_id).toBe(client.clientId);
    await expectRefused(refreshed.access_token);
  });

  it("keeps client_id through $issuer.refreshToken(), where /_auth/refresh ends too", async () => {
    const { app, jwt, client, codeGrant, expectRefused } = await setup();

    const first = await codeGrant();
    const { tokens } = await app.realm.refreshToken(first.refresh_token);

    const { result } = await jwt.parse(tokens.access_token, "users");
    expect(result.payload.client_id).toBe(client.clientId);
    await expectRefused(tokens.access_token);
  });

  it("still passes a session, and still lets a connected app read and call permission-checked actions", async () => {
    const { app, user, codeGrant, call } = await setup();

    const session = await app.realm.createToken({
      id: user.id,
      roles: ["user"],
    });
    const asSession = await call(
      "PATCH",
      "/api/users/me",
      session.access_token,
      {
        firstName: "Signed In",
      },
    );
    expect(asSession.status).toBe(200);

    const connected = await codeGrant();
    const me = await call("GET", "/api/users/me", connected.access_token);
    expect(me.status).toBe(200);
    // `api-key:read` is a permission-checked action the user's role grants.
    const keys = await call("GET", "/api/api-keys", connected.access_token);
    expect(keys.status).toBe(200);
  });
});
