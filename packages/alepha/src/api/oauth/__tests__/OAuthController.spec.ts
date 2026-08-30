import { createHash, randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { cacheOptions } from "alepha/cache";
import {
  MemoryDestinationProvider,
  LogDestinationProvider,
} from "alepha/logger";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $issuer, SecurityProvider, type UserAccount } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { OAuthController } from "../controllers/OAuthController.ts";
import { renderConsentPage } from "../helpers/consentPage.ts";
import { buildAuthorizationServerMetadata } from "../helpers/oauthMetadata.ts";
import { AlephaOAuth, oauthOptions } from "../index.ts";
import { OAuthClientService } from "../services/OAuthClientService.ts";

describe("oauth helpers", () => {
  it("builds AS metadata with absolute endpoints", ({ expect }) => {
    const m = buildAuthorizationServerMetadata("https://app.com");
    expect(m.token_endpoint).toBe("https://app.com/oauth/token");
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
  });

  // The token endpoint accepts a `client_secret` in the form body, and this
  // document advertised `["none"]` alone: it told a conforming confidential
  // client that its secret would be refused, and contradicted the server's own
  // OpenID configuration, which has always listed both.
  it("advertises the auth methods the token endpoint really accepts", ({
    expect,
  }) => {
    const m = buildAuthorizationServerMetadata("https://app.com");
    expect(m.token_endpoint_auth_methods_supported).toEqual([
      "none",
      "client_secret_post",
    ]);
    expect(m.grant_types_supported).toContain("refresh_token");
  });

  it("escapes client name in the consent page", ({ expect }) => {
    const html = renderConsentPage({
      clientName: "<script>x</script>",
      userName: "Bob",
      scopes: ["mcp"],
      hidden: { client_id: "abc" },
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("OAuthController", () => {
  it("serves authorization server metadata with absolute endpoints", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaOrmPostgres)
      .with(AlephaOAuth);
    alepha.set(oauthOptions, {
      realm: "users",
      resource: "/mcp",
      loginPath: "/login",
    });
    await alepha.start();

    const { hostname } = alepha.inject(ServerProvider);
    const resp = await fetch(
      `${hostname}/.well-known/oauth-authorization-server`,
    );

    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, string>;
    expect(body.token_endpoint.endsWith("/oauth/token")).toBe(true);
    expect(body.registration_endpoint.endsWith("/oauth/register")).toBe(true);
  });

  it("registers a dynamic client and returns a client_id", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaOrmPostgres)
      .with(AlephaOAuth);
    alepha.set(oauthOptions, {
      realm: "users",
      resource: "/mcp",
      loginPath: "/login",
    });
    await alepha.start();

    const { hostname } = alepha.inject(ServerProvider);
    const resp = await fetch(`${hostname}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      }),
    });

    expect(resp.status).toBe(201);
    const body = (await resp.json()) as Record<string, string>;
    expect(body.client_id).toMatch(/^mcp_/);
  });

  /**
   * Dynamic client registration is unauthenticated by design - a client
   * discovering this server has no credential yet - which leaves the write
   * path open: every call creates a row, and nothing bounded how many.
   */
  it("throttles a burst of registrations from one address", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaOrmPostgres)
      .with(AlephaOAuth);
    alepha.set(oauthOptions, {
      realm: "users",
      resource: "/mcp",
      loginPath: "/login",
    });
    await alepha.start();

    const { hostname } = alepha.inject(ServerProvider);
    const register = () =>
      fetch(`${hostname}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Burst",
          redirect_uris: ["https://example.com/cb"],
        }),
      });

    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await register()).status);
    }

    // A real client registers once and keeps its id, so the budget is small.
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    // 429, not 400: a caller that waits and retries is doing the right thing,
    // and only this status tells it so.
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
  });
});

describe("OAuthController authorize + token", () => {
  /**
   * Boot an in-process server with the OAuth module and a "users" issuer
   * registered with the OAuth client service so the token endpoint can mint
   * access tokens.
   */
  const boot = async () => {
    class App {
      issuer = $issuer({ name: "users", secret: "test-secret" });
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
    return { alepha, hostname, service };
  };

  const registerClient = async (
    hostname: string,
    redirectUri: string,
  ): Promise<string> => {
    const resp = await fetch(`${hostname}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Test Client",
        redirect_uris: [redirectUri],
      }),
    });
    const body = (await resp.json()) as Record<string, string>;
    return body.client_id;
  };

  it("redirects unauthenticated authorize requests to /login", async ({
    expect,
  }) => {
    const { hostname } = await boot();
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";
    const clientId = await registerClient(hostname, redirectUri);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: "x",
      code_challenge_method: "S256",
    });
    const resp = await fetch(`${hostname}/oauth/authorize?${params}`, {
      redirect: "manual",
    });

    expect(resp.status).toBe(302);
    expect(resp.headers.get("location")?.startsWith("/login")).toBe(true);
  });

  it("rejects authorize requests with an unknown client_id", async ({
    expect,
  }) => {
    const { hostname } = await boot();
    const params = new URLSearchParams({
      response_type: "code",
      client_id: "mcp_unknown",
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: "x",
      code_challenge_method: "S256",
    });
    const resp = await fetch(`${hostname}/oauth/authorize?${params}`, {
      redirect: "manual",
    });

    expect(resp.status).toBe(400);
  });

  it("exchanges an authorization code for an access token", async ({
    expect,
  }) => {
    const { hostname, service } = await boot();
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";
    const clientId = await registerClient(hostname, redirectUri);

    const verifier = "the-code-verifier-value-1234567890";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const userId = randomUUID();

    const code = await service.createAuthorizationCode("users", {
      userId,
      clientId,
      redirectUri,
      codeChallenge: challenge,
      scopes: ["mcp"],
    });

    const resp = await fetch(`${hostname}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    });

    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, string>;
    expect(typeof body.access_token).toBe("string");
    expect(body.access_token.length).toBeGreaterThan(0);
    expect(body.token_type).toBe("Bearer");
    expect(body.scope).toBe("mcp");
  });

  it("rejects an unsupported grant_type on the token endpoint", async ({
    expect,
  }) => {
    const { hostname } = await boot();
    const resp = await fetch(`${hostname}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
      }).toString(),
    });

    expect(resp.status).toBe(400);
    const body = (await resp.json()) as Record<string, string>;
    expect(body.error).toBe("unsupported_grant_type");
  });
});

describe("OAuthController refresh_token grant", () => {
  /**
   * Boot a server with a **session-backed** issuer (like the platform IdP
   * realm, which wires `onCreateSession`/`onRefreshSession` via
   * `alepha/api/users`). Token-only issuers can't refresh through the endpoint
   * (the old access token isn't carried), so a session store is required to
   * exercise the refresh grant end-to-end.
   */
  const boot = async () => {
    // refresh_token -> the session row, including the OAuth client it was
    // minted for. Mirrors `sessions.clientId` in `alepha/api/users`.
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
    return { hostname, service };
  };

  const registerClient = async (
    hostname: string,
    redirectUri: string,
  ): Promise<string> => {
    const resp = await fetch(`${hostname}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Test Client",
        redirect_uris: [redirectUri],
      }),
    });
    const body = (await resp.json()) as Record<string, string>;
    return body.client_id;
  };

  it("re-mints an id_token on the refresh grant for openid clients", async ({
    expect,
  }) => {
    const { hostname, service } = await boot();
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";
    const clientId = await registerClient(hostname, redirectUri);

    const verifier = "the-code-verifier-value-1234567890";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const userId = randomUUID();

    // 1) authorization_code exchange → access + refresh + id token.
    const code = await service.createAuthorizationCode("users", {
      userId,
      clientId,
      redirectUri,
      codeChallenge: challenge,
      scopes: ["openid"],
    });
    const tokenResp = await fetch(`${hostname}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    });
    expect(tokenResp.status).toBe(200);
    const tokenBody = (await tokenResp.json()) as Record<string, string>;
    expect(typeof tokenBody.refresh_token).toBe("string");
    expect(typeof tokenBody.id_token).toBe("string");

    // 2) refresh_token grant — MUST return a fresh id_token so an id_token-based
    //    relying party (the stateless Club RP forwards the id_token as Bearer)
    //    actually renews its identity, not just the access token.
    const refreshResp = await fetch(`${hostname}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokenBody.refresh_token,
        client_id: clientId,
      }).toString(),
    });
    expect(refreshResp.status).toBe(200);
    const refreshBody = (await refreshResp.json()) as Record<string, string>;
    expect(typeof refreshBody.access_token).toBe("string");
    expect(refreshBody.token_type).toBe("Bearer");
    expect(typeof refreshBody.id_token).toBe("string");
  });

  /**
   * Run a full authorization_code exchange and return the refresh token the
   * grant issued, so a test can then present it on the refresh branch.
   */
  const mintRefreshToken = async (
    hostname: string,
    service: OAuthClientService,
    clientId: string,
    redirectUri: string,
    clientSecret?: string,
  ): Promise<string> => {
    const verifier = "the-code-verifier-value-1234567890";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const code = await service.createAuthorizationCode("users", {
      userId: randomUUID(),
      clientId,
      redirectUri,
      codeChallenge: challenge,
      scopes: ["openid"],
    });
    const resp = await fetch(`${hostname}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
      }).toString(),
    });
    const body = (await resp.json()) as Record<string, string>;
    return body.refresh_token;
  };

  const decodeJwtPayload = (jwt: string): Record<string, unknown> =>
    JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString());

  it("refuses a refresh token minted for a different client", async ({
    expect,
  }) => {
    const { hostname, service } = await boot();
    const victimRedirect = "https://victim.example/cb";
    const victimClient = await registerClient(hostname, victimRedirect);
    const attackerClient = await registerClient(
      hostname,
      "https://attacker.example/cb",
    );

    const refreshToken = await mintRefreshToken(
      hostname,
      service,
      victimClient,
      victimRedirect,
    );

    // The attacker presents someone else's refresh token under their own
    // client_id. Unbound, this mints an id_token whose `aud` is the attacker's
    // client — which any RP that forwards id_tokens as Bearer will accept.
    const resp = await fetch(`${hostname}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: attackerClient,
      }).toString(),
    });

    expect(resp.status).toBe(400);
    const body = (await resp.json()) as Record<string, string>;
    expect(body.error).toBe("invalid_grant");
    expect(body.id_token).toBeUndefined();
  });

  it("requires the client secret to refresh a confidential client", async ({
    expect,
  }) => {
    const { hostname, service } = await boot();
    const redirectUri = "https://confidential.example/cb";
    const client = await service.register({
      realm: "users",
      clientName: "Confidential Client",
      redirectUris: [redirectUri],
      scopes: ["openid"],
      type: "confidential",
      secret: "the-client-secret",
    });

    const refreshToken = await mintRefreshToken(
      hostname,
      service,
      client.clientId,
      redirectUri,
      "the-client-secret",
    );

    const resp = await fetch(`${hostname}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: client.clientId,
        client_secret: "wrong-secret",
      }).toString(),
    });

    expect(resp.status).toBe(401);
    const body = (await resp.json()) as Record<string, string>;
    expect(body.error).toBe("invalid_client");
  });

  it("refuses a refresh request from an unknown client", async ({ expect }) => {
    const { hostname, service } = await boot();
    const redirectUri = "https://known.example/cb";
    const clientId = await registerClient(hostname, redirectUri);
    const refreshToken = await mintRefreshToken(
      hostname,
      service,
      clientId,
      redirectUri,
    );

    const resp = await fetch(`${hostname}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: "mcp_does_not_exist",
      }).toString(),
    });

    expect(resp.status).toBe(400);
    const body = (await resp.json()) as Record<string, string>;
    expect(body.error).toBe("invalid_client");
  });

  it("keeps the id_token audience bound to the authenticated client", async ({
    expect,
  }) => {
    const { hostname, service } = await boot();
    const redirectUri = "https://known.example/cb";
    const clientId = await registerClient(hostname, redirectUri);
    const refreshToken = await mintRefreshToken(
      hostname,
      service,
      clientId,
      redirectUri,
    );

    const resp = await fetch(`${hostname}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }).toString(),
    });

    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, string>;
    expect(decodeJwtPayload(body.id_token).aud).toBe(clientId);
  });
});

describe("OAuth consent cannot be skipped by the request", () => {
  /**
   * Same shape as the authorize+token boot, but the `App` instance is returned
   * so a test can mint a genuine access token for an already-logged-in victim.
   */
  const boot = async () => {
    class App {
      issuer = $issuer({ name: "users", secret: "test-secret" });
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
    return { alepha, app, hostname, service };
  };

  const authorize = async (
    hostname: string,
    accessToken: string,
    params: Record<string, string>,
  ) => {
    const query = new URLSearchParams({
      response_type: "code",
      code_challenge: "x",
      code_challenge_method: "S256",
      ...params,
    });
    return fetch(`${hostname}/oauth/authorize?${query}`, {
      redirect: "manual",
      headers: { authorization: `Bearer ${accessToken}` },
    });
  };

  it("answers consent_required when an untrusted client asks for prompt=none", async ({
    expect,
  }) => {
    const { app, hostname, service } = await boot();
    const redirectUri = "https://evil.example/cb";
    const client = await service.register({
      realm: "users",
      clientName: "Registered By Anyone",
      redirectUris: [redirectUri],
      scopes: ["mcp"],
    });
    // The victim is logged into the AS — the cookie is Lax, so it rides along
    // on a cross-site top-level GET and the user resolves.
    const { access_token } = await app.issuer.createToken({
      id: "victim-user-id",
      roles: [],
    } as UserAccount);

    const resp = await authorize(hostname, access_token, {
      client_id: client.clientId,
      redirect_uri: redirectUri,
      prompt: "none",
      state: "s1",
    });

    expect(resp.status).toBe(302);
    const location = new URL(resp.headers.get("location") ?? "");
    // prompt=none means "do not show UI", never "consent is granted".
    expect(location.searchParams.get("code")).toBeNull();
    expect(location.searchParams.get("error")).toBe("consent_required");
    expect(location.searchParams.get("state")).toBe("s1");
  });

  it("still skips consent for a trusted first-party client", async ({
    expect,
  }) => {
    const { app, hostname, service } = await boot();
    const redirectUri = "https://app.alepha.club/auth/callback";
    const client = await service.register({
      realm: "users",
      clientName: "First Party",
      redirectUris: [redirectUri],
      scopes: ["openid"],
      trusted: true,
    });
    const { access_token } = await app.issuer.createToken({
      id: "user-1",
      roles: [],
    } as UserAccount);

    const resp = await authorize(hostname, access_token, {
      client_id: client.clientId,
      redirect_uri: redirectUri,
    });

    expect(resp.status).toBe(302);
    const location = new URL(resp.headers.get("location") ?? "");
    expect(location.searchParams.get("code")).toBeTruthy();
  });
});

describe("OAuth bearer tokens are access tokens only", () => {
  const boot = async () => {
    class App {
      issuer = $issuer({ name: "users", secret: "test-secret" });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaOAuth);
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

    return { alepha, app, service };
  };

  const resolve = (alepha: Alepha, token: string) =>
    alepha.inject(SecurityProvider).resolveUserFromServerRequest({
      url: new URL("https://app.com/mcp"),
      headers: { authorization: `Bearer ${token}` },
    });

  it("refuses an authorization code presented as a Bearer token", async ({
    expect,
  }) => {
    const { alepha, service } = await boot();

    const code = await service.createAuthorizationCode("users", {
      userId: "victim-user-id",
      clientId: "mcp_x",
      redirectUri: "https://evil.example/cb",
      codeChallenge: "x",
      scopes: ["mcp"],
    });

    // Seeing a code — browser history, Referer, proxy logs — must not be
    // enough to act as its subject. Otherwise PKCE protects nothing: the
    // attacker never has to reach /oauth/token at all.
    expect(await resolve(alepha, code)).toBeUndefined();
  });

  it("refuses an id_token presented as a Bearer token", async ({ expect }) => {
    const { alepha, service } = await boot();

    const idToken = await service.issueIdToken("users", {
      userId: "victim-user-id",
      clientId: "mcp_x",
      issuer: "https://app.com",
    });

    expect(await resolve(alepha, idToken)).toBeUndefined();
  });

  it("still accepts a genuine access token", async ({ expect }) => {
    const { alepha, app } = await boot();

    const { access_token } = await app.issuer.createToken({
      id: "user-1",
      roles: [],
    } as UserAccount);

    expect((await resolve(alepha, access_token))?.id).toBe("user-1");
  });
});

describe("device authorization grant", () => {
  const boot = async () => {
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaOrmPostgres)
      .with(AlephaOAuth);
    alepha.set(oauthOptions, {
      realm: "users",
      resource: "/mcp",
      loginPath: "/login",
    });
    await alepha.start();
    return alepha;
  };

  it("advertises the grant so a device can discover it", async ({ expect }) => {
    const alepha = await boot();
    const { hostname } = alepha.inject(ServerProvider);

    const meta = await fetch(
      `${hostname}/.well-known/oauth-authorization-server`,
    ).then((r) => r.json());

    // Discovered rather than configured into every client.
    expect(meta.device_authorization_endpoint).toBe(
      `${hostname}/oauth/device_authorization`,
    );
    expect(meta.grant_types_supported).toContain(
      "urn:ietf:params:oauth:grant-type:device_code",
    );
  });

  it("issues a code pair and a verification URI a human can use", async ({
    expect,
  }) => {
    const alepha = await boot();
    const { hostname } = alepha.inject(ServerProvider);

    const res = await fetch(`${hostname}/oauth/device_authorization`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: "cli", scope: "openid" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(body.verification_uri).toBe(`${hostname}/device`);
    // RFC 8628 §3.3.1 — the same page with the code filled in, for anyone who
    // can follow a link. The plain URI stays, for anyone who cannot.
    expect(body.verification_uri_complete).toContain("user_code=");
    expect(body.interval).toBeGreaterThan(0);
    expect(body.expires_in).toBeGreaterThan(0);
  });

  it("tells a polling device to keep waiting, in the words RFC 8628 defines", async ({
    expect,
  }) => {
    const alepha = await boot();
    const { hostname } = alepha.inject(ServerProvider);

    const start = await fetch(`${hostname}/oauth/device_authorization`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: "cli" }),
    }).then((r) => r.json());

    const res = await fetch(`${hostname}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: start.device_code,
        client_id: "cli",
      }),
    });
    expect(res.status).toBe(400);
    // A correct client branches on this exact string; anything friendlier would
    // make it unimplementable.
    expect((await res.json()).error).toBe("authorization_pending");
  });

  it("refuses an unknown device code as expired, saying nothing more", async ({
    expect,
  }) => {
    const alepha = await boot();
    const { hostname } = alepha.inject(ServerProvider);

    const res = await fetch(`${hostname}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: "made-up",
        client_id: "cli",
      }),
    });
    // Not "no such code": that would confirm which codes ever existed.
    expect((await res.json()).error).toBe("expired_token");
  });
});

/**
 * The two ways the DCR rate limiter used to disappear without saying so.
 *
 * Dynamic client registration is unauthenticated by design, so this limiter
 * is the only thing between an open write path and an unbounded row count.
 * Both bypasses were silent, which is what made them worth a quest: the
 * control was absent and looked present.
 */
describe("OAuthController — the DCR limiter cannot silently disappear", () => {
  const boot = async (
    env?: Record<string, string | boolean>,
    cache?: object,
  ) => {
    // The substitution goes FIRST: the container refuses one for a service
    // something has already used, and the modules below inject the logger.
    const alepha = Alepha.create(env ? { env } : undefined)
      .with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
      })
      .with(AlephaServer)
      .with(AlephaOrmPostgres)
      .with(AlephaOAuth);
    alepha.set(oauthOptions, {
      realm: "users",
      resource: "/mcp",
      loginPath: "/login",
    });
    if (cache) alepha.set(cacheOptions, cache as any);
    await alepha.start();
    return alepha;
  };

  const register = (hostname: string, name: string) =>
    fetch(`${hostname}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      }),
    });

  it("refuses the eleventh registration from one address", async ({
    expect,
  }) => {
    const alepha = await boot();
    const { hostname } = alepha.inject(ServerProvider);

    for (let n = 0; n < 10; n++) {
      expect((await register(hostname, `Client ${n}`)).status).toBe(201);
    }

    // The window is fifteen minutes and the counter is created with it, so
    // the eleventh is refused rather than sliding.
    const refused = await register(hostname, "Client 11");
    expect(refused.status).toBe(429);
  });

  it("counts a registration with no client address, and says so", ({
    expect,
  }) => {
    // Reached directly: a request over a real socket always has a connection
    // IP, so no HTTP test can produce the `undefined` this branch exists for.
    class TestOAuthController extends OAuthController {
      public testBucket = this.registrationBucket.bind(this);
    }

    const alepha = Alepha.create()
      .with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
      })
      .with(AlephaServer)
      .with(AlephaOrmPostgres)
      .with(AlephaOAuth);
    alepha.set(oauthOptions, {
      realm: "users",
      resource: "/mcp",
      loginPath: "/login",
    });
    const controller = alepha.inject(TestOAuthController);
    const logs = alepha.inject(MemoryDestinationProvider);

    expect(controller.testBucket("203.0.113.7")).toBe("203.0.113.7");
    expect(logs.logs.filter((l) => l.level === "WARN")).toHaveLength(0);

    // Bucketed, not exempted — the old code returned early and counted
    // nothing at all.
    expect(controller.testBucket(undefined)).toBe("unknown");
    const warnings = logs.logs.filter((l) => l.level === "WARN");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("TRUST_PROXY");
  });

  it("refuses registration in production when the cache is disabled", async ({
    expect,
  }) => {
    // `incr` answers 1 from a disabled cache, which is indistinguishable from
    // a first call — so without asking, the endpoint would serve an unlimited
    // registration path and report success.
    // Two more env vars, both about getting a production container to boot
    // at all rather than about the limiter: production refuses the built-in
    // `APP_SECRET`, and it refuses to push a schema, which this app has no
    // migrations for. Neither is reached — the 503 fires before any query.
    const alepha = await boot(
      {
        NODE_ENV: "production",
        APP_SECRET: "a-strong-unique-secret",
        DATABASE_SYNC: false,
      },
      { enabled: false },
    );
    const { hostname } = alepha.inject(ServerProvider);

    const resp = await register(hostname, "Claude");
    expect(resp.status).toBe(503);
  });

  it("warns but still registers outside production with the cache disabled", async ({
    expect,
  }) => {
    // A developer running with caching off must not be blocked; only a
    // production deploy is refused.
    const alepha = await boot(undefined, { enabled: false });
    const { hostname } = alepha.inject(ServerProvider);
    const logs = alepha.inject(MemoryDestinationProvider);

    const resp = await register(hostname, "Claude");
    expect(resp.status).toBe(201);
    expect(
      logs.logs.some(
        (l) => l.level === "WARN" && l.message.includes("unbounded"),
      ),
    ).toBe(true);
  });
});
