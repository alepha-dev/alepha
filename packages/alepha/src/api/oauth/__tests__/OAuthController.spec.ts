import { createHash, randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $issuer, type UserAccount } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";
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
