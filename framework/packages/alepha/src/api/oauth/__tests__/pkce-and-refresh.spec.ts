import { createHash, randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $issuer, type UserAccount } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { AlephaOAuth, oauthOptions } from "../index.ts";
import { OAuthClientService } from "../services/OAuthClientService.ts";

/**
 * PKCE and the refresh grant, where a mistake hands a token to someone who
 * should not have one. The Origin and consent checks live in
 * `OAuthController.spec.ts` (#Q2655), and are not repeated here.
 */
const boot = async () => {
  // refresh_token -> the session it continues, like `sessions` in
  // `alepha/api/users`: a refresh grant needs a session store.
  const sessions = new Map<string, { userId: string; clientId?: string }>();

  class App {
    issuer = $issuer({
      name: "users",
      secret: "test-secret",
      settings: {
        onCreateSession: async (user, config) => {
          const refreshToken = randomUUID();
          sessions.set(refreshToken, {
            userId: user.id,
            clientId: config.clientId,
          });
          return { refreshToken, sessionId: randomUUID() };
        },
        onRefreshSession: async (refreshToken) => {
          const session = sessions.get(refreshToken);
          if (!session) throw new Error("unknown refresh token");
          return {
            user: { id: session.userId, roles: [] } as UserAccount,
            expiresIn: 3600,
            clientId: session.clientId,
          };
        },
      },
    });
  }

  const alepha = Alepha.create()
    .with(AlephaServer)
    .with(AlephaOrmPostgres)
    .with(AlephaOAuth);
  alepha.set(oauthOptions, {
    realm: "users",
    resource: "/mcp",
    loginPath: "/login",
  });
  const app = alepha.inject(App);
  await alepha.start();

  const service = alepha.inject(OAuthClientService);
  service.registerIssuer(
    "users",
    app.issuer,
    async (id) => ({ id, roles: [] }) as UserAccount,
  );
  const { hostname } = alepha.inject(ServerProvider);

  const redirectUri = "https://client.example/cb";
  const client = await service.register({
    realm: "users",
    clientName: "Some Client",
    redirectUris: [redirectUri],
    scopes: ["mcp"],
  });
  const clientId = client.clientId;

  const verifier = "the-code-verifier-value-1234567890-abcdef";
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const code = () =>
    service.createAuthorizationCode("users", {
      userId: randomUUID(),
      clientId,
      redirectUri,
      codeChallenge: challenge,
      scopes: ["mcp"],
    });

  const token = (params: Record<string, string>) =>
    fetch(`${hostname}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        ...params,
      }).toString(),
    });

  const session = async () =>
    (
      await app.issuer.createToken({
        id: "user-1",
        roles: [],
      } as UserAccount)
    ).access_token;

  return {
    hostname,
    clientId,
    redirectUri,
    verifier,
    challenge,
    code,
    token,
    session,
  };
};

describe("OAuth PKCE", () => {
  it("refuses the plain method at /oauth/authorize: only S256", async () => {
    const { hostname, clientId, redirectUri, verifier, session } = await boot();

    const resp = await fetch(
      `${hostname}/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: verifier,
        code_challenge_method: "plain",
      })}`,
      {
        redirect: "manual",
        headers: { authorization: `Bearer ${await session()}` },
      },
    );

    expect(resp.status).toBe(400);
    expect(await resp.text()).toContain("S256");
    expect(resp.headers.get("location")).toBeNull();
  });

  it("exchanges a code for the verifier whose S256 hash it was bound to", async () => {
    const { code, token, verifier } = await boot();

    const resp = await token({
      grant_type: "authorization_code",
      code: await code(),
      code_verifier: verifier,
    });

    expect(resp.status).toBe(200);
    expect((await resp.json()).access_token).toBeTruthy();
  });

  it("refuses a code presented with the wrong verifier, or none", async () => {
    const { code, token } = await boot();

    const wrong = await token({
      grant_type: "authorization_code",
      code: await code(),
      code_verifier: "not-the-verifier-not-the-verifier-0000",
    });
    const missing = await token({
      grant_type: "authorization_code",
      code: await code(),
    });

    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(wrong.status).toBeLessThan(500);
    expect((await wrong.text()).includes("access_token")).toBe(false);
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(missing.status).toBeLessThan(500);
    expect((await missing.text()).includes("access_token")).toBe(false);
  });

  it("refuses the plain verifier itself as the challenge's answer", async () => {
    const { token, verifier, challenge, code } = await boot();
    // The challenge sent instead of the verifier: what a `plain` client
    // would do. S256 only, so it does not match.
    const resp = await token({
      grant_type: "authorization_code",
      code: await code(),
      code_verifier: challenge,
    });

    expect(verifier).not.toBe(challenge);
    expect(resp.status).toBeGreaterThanOrEqual(400);
    expect((await resp.text()).includes("access_token")).toBe(false);
  });

  it("spends a code once: a second exchange is refused", async () => {
    const { code, token, verifier } = await boot();
    const once = await code();

    const first = await token({
      grant_type: "authorization_code",
      code: once,
      code_verifier: verifier,
    });
    const second = await token({
      grant_type: "authorization_code",
      code: once,
      code_verifier: verifier,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect((await second.text()).includes("access_token")).toBe(false);
  });
});

describe("OAuth refresh grant", () => {
  const signIn = async (env: Awaited<ReturnType<typeof boot>>) => {
    const resp = await env.token({
      grant_type: "authorization_code",
      code: await env.code(),
      code_verifier: env.verifier,
    });
    expect(resp.status).toBe(200);
    return (await resp.json()).refresh_token as string;
  };

  /**
   * No rotation, by design: a session refresh hands back the SAME refresh
   * token (see the comment on the refresh branch), so a refused or retried
   * request spends nothing. Pinned here, so a change to rotation is a
   * decision rather than a side effect.
   */
  it("hands back the same refresh token, which keeps working", async () => {
    const env = await boot();
    const refreshToken = await signIn(env);

    const first = await env.token({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const second = await env.token({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const body = await first.json();
    expect(body.refresh_token).toBe(refreshToken);
    expect(body.access_token).toBeTruthy();
  });

  it("refuses a refresh token nobody issued", async () => {
    const env = await boot();
    await signIn(env);

    const resp = await env.token({
      grant_type: "refresh_token",
      refresh_token: randomUUID(),
    });

    expect(resp.status).toBeGreaterThanOrEqual(400);
    expect((await resp.text()).includes("access_token")).toBe(false);
  });

  it("refuses a refresh that names no client", async () => {
    const env = await boot();
    const refreshToken = await signIn(env);

    const resp = await env.token({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: "",
    });

    expect(resp.status).toBe(400);
    expect((await resp.json()).error).toBe("invalid_client");
  });
});
