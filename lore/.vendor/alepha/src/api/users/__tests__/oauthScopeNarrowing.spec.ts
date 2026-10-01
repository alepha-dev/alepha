import { createHash, randomUUID } from "node:crypto";

import { Alepha, z } from "alepha";
import { OAuthClientService, oauthOptions } from "alepha/api/oauth";
import { AlephaEmail } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $secure, AlephaSecurity, JwtProvider } from "alepha/security";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { $realm, AlephaApiUsers, RealmProvider } from "../index.ts";

/**
 * A connected app reaches what its granted scopes declare, not everything its
 * user's roles grant. The grant's scope ids live on the session, resolve to a
 * permission list in `$issuer` at every mint, and ride in the token as the
 * `permissionScope` every permission check enforces.
 */
class TestApp {
  realm = $realm({ features: { apiKeys: true, oauth: true } });

  readDocs = $action({
    path: "/docs-scope/read",
    use: [$secure({ permissions: ["docs:read"] })],
    schema: { response: z.text() },
    handler: () => "READ",
  });

  writeDocs = $action({
    method: "POST",
    path: "/docs-scope/write",
    use: [$secure({ permissions: ["docs:write"] })],
    schema: { response: z.text() },
    handler: () => "WRITTEN",
  });
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaServer)
    .with(AlephaOrmPostgres)
    .with(AlephaSecurity)
    .with(AlephaEmail)
    .with(AlephaApiUsers);
  alepha.set(oauthOptions, {
    ...oauthOptions.options.default,
    scopes: {
      read: { label: "Read your documents", permissions: ["docs:read"] },
      openid: { label: "Your identity", permissions: [] },
      legacy: { label: "Declared for its copy only" },
    },
  });
  alepha.inject(TestApp);
  await alepha.start();

  const { hostname } = alepha.inject(ServerProvider);
  const oauth = alepha.inject(OAuthClientService);
  const jwt = alepha.inject(JwtProvider);

  const username = `scopes-${randomUUID().slice(0, 8)}`;
  const user = await alepha
    .inject(RealmProvider)
    .userRepository()
    .create({ username, email: `${username}@example.com`, roles: ["user"] });

  const redirectUri = "https://connected.example.com/callback";
  const client = await oauth.register({
    realm: "users",
    clientName: `Scoped App ${randomUUID()}`,
    redirectUris: [redirectUri],
    scopes: ["read", "openid", "legacy"],
  });

  const post = async (path: string, body: Record<string, string>) => {
    const response = await fetch(`${hostname}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, string>;
  };

  const grant = async (scopes: string[]) => {
    const verifier = `verifier-${randomUUID()}`;
    const code = await oauth.createAuthorizationCode("users", {
      userId: user.id,
      clientId: client.clientId,
      redirectUri,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      scopes,
    });
    return post("/oauth/token", {
      grant_type: "authorization_code",
      code,
      client_id: client.clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
  };

  const refreshAtOAuth = (refreshToken: string) =>
    post("/oauth/token", {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: client.clientId,
    });

  const refreshAtAuth = async (refreshToken: string) => {
    const response = await fetch(
      `${hostname}/_auth/refresh?provider=credentials&realm=users`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, string>;
  };

  const status = async (method: string, path: string, bearer: string) => {
    const response = await fetch(`${hostname}${path}`, {
      method,
      headers: { authorization: `Bearer ${bearer}` },
    });
    return { status: response.status, text: await response.text() };
  };

  const claim = async (accessToken: string) =>
    (await jwt.parse(accessToken, "users")).result.payload.permission_scope;

  return {
    alepha,
    grant,
    refreshAtOAuth,
    refreshAtAuth,
    status,
    claim,
  };
};

describe("OAuth grant scopes narrow the token", () => {
  it("refuses a permission the user's roles grant but the grant's scopes do not", async () => {
    const { grant, status, claim } = await setup();

    const tokens = await grant(["read"]);
    expect(await claim(tokens.access_token)).toEqual(["docs:read"]);

    expect(
      (await status("GET", "/api/docs-scope/read", tokens.access_token)).status,
    ).toBe(200);
    const refused = await status(
      "POST",
      "/api/docs-scope/write",
      tokens.access_token,
    );
    expect(refused.status).toBe(403);
    expect(refused.text).toContain(
      "outside this credential's permission scope",
    );
  });

  it("keeps the narrowing after a refresh at /oauth/token", async () => {
    const { grant, refreshAtOAuth, status, claim } = await setup();

    const first = await grant(["read"]);
    const refreshed = await refreshAtOAuth(first.refresh_token);

    expect(await claim(refreshed.access_token)).toEqual(["docs:read"]);
    expect(
      (await status("POST", "/api/docs-scope/write", refreshed.access_token))
        .status,
    ).toBe(403);
  });

  it("keeps the narrowing after a refresh at /_auth/refresh, which checks no client", async () => {
    const { grant, refreshAtAuth, status, claim } = await setup();

    const first = await grant(["read"]);
    const refreshed = await refreshAtAuth(first.refresh_token);

    expect(await claim(refreshed.access_token)).toEqual(["docs:read"]);
    expect(
      (await status("POST", "/api/docs-scope/write", refreshed.access_token))
        .status,
    ).toBe(403);
  });

  it("resolves the declaration at every mint, so a changed declaration applies at the next refresh", async () => {
    const { alepha, grant, refreshAtOAuth, claim } = await setup();

    const first = await grant(["read"]);
    alepha.set(oauthOptions, {
      ...alepha.get(oauthOptions)!,
      scopes: {
        ...alepha.get(oauthOptions)!.scopes,
        read: {
          label: "Read and write your documents",
          permissions: ["docs:read", "docs:write"],
        },
      },
    });

    const refreshed = await refreshAtOAuth(first.refresh_token);
    expect(await claim(refreshed.access_token)).toEqual([
      "docs:read",
      "docs:write",
    ]);
  });

  it("leaves a grant unrestricted when one of its scopes declares no permissions", async () => {
    const { grant, status, claim } = await setup();

    const legacy = await grant(["read", "legacy"]);
    expect(await claim(legacy.access_token)).toBeUndefined();
    expect(
      (await status("POST", "/api/docs-scope/write", legacy.access_token))
        .status,
    ).toBe(200);
  });

  it("gives an openid-only grant no permission-checked route, and still lets it read who it is", async () => {
    const { grant, status, claim } = await setup();

    const identity = await grant(["openid"]);
    expect(await claim(identity.access_token)).toEqual([]);

    expect(
      (await status("GET", "/api/docs-scope/read", identity.access_token))
        .status,
    ).toBe(403);
    expect(
      (await status("GET", "/api/users/me", identity.access_token)).status,
    ).toBe(200);
  });
});
