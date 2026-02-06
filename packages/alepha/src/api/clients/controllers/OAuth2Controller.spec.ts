import { Alepha } from "alepha";
import { $issuer, AlephaSecurity } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";
import { AlephaApiClients } from "../index.ts";
import { OAuth2Service } from "../services/OAuth2Service.ts";

const setup = async () => {
  class TestApp {
    issuer = $issuer({
      secret: "test-secret-oauth2-ctrl",
      roles: [
        { name: "admin", permissions: [{ name: "*" }] },
        {
          name: "user",
          permissions: [{ name: "profile:read" }, { name: "items:read" }],
        },
      ],
    });
  }

  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaApiClients);

  const app = alepha.inject(TestApp);
  const service = alepha.inject(OAuth2Service);
  const server = alepha.inject(ServerProvider);

  await alepha.start();

  service.issuer = app.issuer;
  service.realmName = app.issuer.name;

  const baseUrl = server.hostname;

  /**
   * Helper to create a confidential client ready for testing.
   */
  async function createConfidentialClient(
    overrides: Partial<Parameters<OAuth2Service["createClient"]>[0]> = {},
  ) {
    return service.createClient({
      name: "Test Confidential Client",
      redirectUris: ["http://localhost:3000/callback"],
      grantTypes: ["authorization_code", "client_credentials", "refresh_token"],
      scopes: ["profile:read", "items:read"],
      ...overrides,
    });
  }

  /**
   * Helper to encode Basic auth header.
   */
  function basicAuth(clientId: string, clientSecret: string) {
    return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }

  return { alepha, app, service, baseUrl, createConfidentialClient, basicAuth };
};

// -----------------------------------------------------------------------------------------------------------------------
// Token Endpoint
// -----------------------------------------------------------------------------------------------------------------------

describe("OAuth2Controller", () => {
  describe("POST /oauth2/token", () => {
    it("should reject missing client_id", async ({ expect }) => {
      const { baseUrl } = await setup();

      const resp = await fetch(`${baseUrl}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=authorization_code&code=abc",
      });

      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("client_id");
    });

    it("should reject unsupported grant type", async ({ expect }) => {
      const { baseUrl, createConfidentialClient, basicAuth } = await setup();
      const { client, clientSecret } = await createConfidentialClient();

      const resp = await fetch(`${baseUrl}/oauth2/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(client.clientId, clientSecret!),
        },
        body: "grant_type=implicit",
      });

      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toBe("unsupported_grant_type");
    });

    it("should reject authorization_code without code", async ({ expect }) => {
      const { baseUrl, createConfidentialClient, basicAuth } = await setup();
      const { client, clientSecret } = await createConfidentialClient();

      const resp = await fetch(`${baseUrl}/oauth2/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(client.clientId, clientSecret!),
        },
        body: "grant_type=authorization_code&redirect_uri=http://localhost:3000/callback&code_verifier=abc",
      });

      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("code");
    });

    it("should reject refresh_token without refresh_token param", async ({
      expect,
    }) => {
      const { baseUrl, createConfidentialClient, basicAuth } = await setup();
      const { client, clientSecret } = await createConfidentialClient();

      const resp = await fetch(`${baseUrl}/oauth2/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(client.clientId, clientSecret!),
        },
        body: "grant_type=refresh_token",
      });

      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("refresh_token");
    });

    it("should issue token via client_credentials with Basic auth", async ({
      expect,
    }) => {
      const { baseUrl, createConfidentialClient, basicAuth } = await setup();
      const { client, clientSecret } = await createConfidentialClient();

      const resp = await fetch(`${baseUrl}/oauth2/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(client.clientId, clientSecret!),
        },
        body: "grant_type=client_credentials&scope=profile:read",
      });

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.access_token).toBeTruthy();
      expect(body.token_type).toBe("Bearer");
      expect(body.expires_in).toBeGreaterThan(0);
      expect(body.scope).toBe("profile:read");
    });

    it("should issue token via client_credentials with body credentials", async ({
      expect,
    }) => {
      const { baseUrl, createConfidentialClient } = await setup();
      const { client, clientSecret } = await createConfidentialClient({
        tokenEndpointAuthMethod: "client_secret_post",
      });

      const params = new URLSearchParams();
      params.set("grant_type", "client_credentials");
      params.set("client_id", client.clientId);
      params.set("client_secret", clientSecret!);
      params.set("scope", "items:read");

      const resp = await fetch(`${baseUrl}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.access_token).toBeTruthy();
      expect(body.scope).toBe("items:read");
    });

    it("should accept JSON content type", async ({ expect }) => {
      const { baseUrl, createConfidentialClient, basicAuth } = await setup();
      const { client, clientSecret } = await createConfidentialClient();

      const resp = await fetch(`${baseUrl}/oauth2/token`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: basicAuth(client.clientId, clientSecret!),
        },
        body: JSON.stringify({
          grant_type: "client_credentials",
          scope: "profile:read",
        }),
      });

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.access_token).toBeTruthy();
    });

    it("should include Cache-Control: no-store on token responses", async ({
      expect,
    }) => {
      const { baseUrl, createConfidentialClient, basicAuth } = await setup();
      const { client, clientSecret } = await createConfidentialClient();

      const resp = await fetch(`${baseUrl}/oauth2/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(client.clientId, clientSecret!),
        },
        body: "grant_type=client_credentials&scope=profile:read",
      });

      expect(resp.status).toBe(200);
      expect(resp.headers.get("cache-control")).toBe("no-store");
      expect(resp.headers.get("pragma")).toBe("no-cache");
    });

    it("should include WWW-Authenticate on 401 token responses", async ({
      expect,
    }) => {
      const { baseUrl, createConfidentialClient, basicAuth } = await setup();
      const { client } = await createConfidentialClient();

      const resp = await fetch(`${baseUrl}/oauth2/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(client.clientId, "wrong-secret"),
        },
        body: "grant_type=client_credentials",
      });

      expect(resp.status).toBe(401);
      expect(resp.headers.get("www-authenticate")).toBe("Basic");
    });

    it("should reject invalid client credentials", async ({ expect }) => {
      const { baseUrl, createConfidentialClient, basicAuth } = await setup();
      const { client } = await createConfidentialClient();

      const resp = await fetch(`${baseUrl}/oauth2/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(client.clientId, "wrong-secret"),
        },
        body: "grant_type=client_credentials",
      });

      expect(resp.status).toBe(401);
      const body = await resp.json();
      expect(body.error).toBe("invalid_client");
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------
  // Revocation Endpoint
  // -----------------------------------------------------------------------------------------------------------------------

  describe("POST /oauth2/revoke", () => {
    it("should always return 200 (even for invalid tokens)", async ({
      expect,
    }) => {
      const { baseUrl } = await setup();

      const resp = await fetch(`${baseUrl}/oauth2/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "invalid-token" }),
      });

      expect(resp.status).toBe(200);
    });

    it("should reject revocation with invalid client credentials", async ({
      expect,
    }) => {
      const { baseUrl, createConfidentialClient, basicAuth } = await setup();
      const { client } = await createConfidentialClient();

      const resp = await fetch(`${baseUrl}/oauth2/revoke`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: basicAuth(client.clientId, "wrong-secret"),
        },
        body: JSON.stringify({ token: "some-token" }),
      });

      expect(resp.status).toBe(401);
      expect(resp.headers.get("www-authenticate")).toBe("Basic");
    });

    it("should revoke a valid token", async ({ expect }) => {
      const { baseUrl, service, createConfidentialClient, basicAuth } =
        await setup();
      const { client, clientSecret } = await createConfidentialClient();

      // Issue a token
      const tokenResp = await fetch(`${baseUrl}/oauth2/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(client.clientId, clientSecret!),
        },
        body: "grant_type=client_credentials",
      });
      const { access_token } = await tokenResp.json();

      // Revoke it
      const revokeResp = await fetch(`${baseUrl}/oauth2/revoke`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: basicAuth(client.clientId, clientSecret!),
        },
        body: JSON.stringify({ token: access_token }),
      });
      expect(revokeResp.status).toBe(200);

      // Verify introspection shows inactive
      const introspection = await service.introspect(access_token);
      expect(introspection.active).toBe(false);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------
  // Introspection Endpoint
  // -----------------------------------------------------------------------------------------------------------------------

  describe("POST /oauth2/introspect", () => {
    it("should return active=true for valid token", async ({ expect }) => {
      const { baseUrl, createConfidentialClient, basicAuth } = await setup();
      const { client, clientSecret } = await createConfidentialClient();

      // Issue a token
      const tokenResp = await fetch(`${baseUrl}/oauth2/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(client.clientId, clientSecret!),
        },
        body: "grant_type=client_credentials&scope=profile:read",
      });
      const { access_token } = await tokenResp.json();

      // Introspect
      const resp = await fetch(`${baseUrl}/oauth2/introspect`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: basicAuth(client.clientId, clientSecret!),
        },
        body: JSON.stringify({ token: access_token }),
      });

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.active).toBe(true);
      expect(body.sub).toContain("client:");
      expect(body.token_type).toBe("Bearer");
      expect(body.scope).toBe("profile:read");
    });

    it("should return active=false for invalid token", async ({ expect }) => {
      const { baseUrl, createConfidentialClient, basicAuth } = await setup();
      const { client, clientSecret } = await createConfidentialClient();

      const resp = await fetch(`${baseUrl}/oauth2/introspect`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: basicAuth(client.clientId, clientSecret!),
        },
        body: JSON.stringify({ token: "not-a-valid-token" }),
      });

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.active).toBe(false);
    });

    it("should reject unauthenticated introspection requests", async ({
      expect,
    }) => {
      const { baseUrl } = await setup();

      const resp = await fetch(`${baseUrl}/oauth2/introspect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "some-token" }),
      });

      expect(resp.status).toBe(401);
      expect(resp.headers.get("www-authenticate")).toBe("Basic");
      const body = await resp.json();
      expect(body.error).toBe("invalid_client");
    });

    it("should return active=false for invalid client credentials", async ({
      expect,
    }) => {
      const { baseUrl, createConfidentialClient, basicAuth } = await setup();
      const { client, clientSecret } = await createConfidentialClient();

      // Issue a valid token
      const tokenResp = await fetch(`${baseUrl}/oauth2/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(client.clientId, clientSecret!),
        },
        body: "grant_type=client_credentials",
      });
      const { access_token } = await tokenResp.json();

      // Introspect with wrong credentials
      const resp = await fetch(`${baseUrl}/oauth2/introspect`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: basicAuth(client.clientId, "wrong-secret"),
        },
        body: JSON.stringify({ token: access_token }),
      });

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.active).toBe(false);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------
  // Authorization Endpoint
  // -----------------------------------------------------------------------------------------------------------------------

  describe("GET /oauth2/authorize", () => {
    it("should redirect to login when user is not authenticated", async ({
      expect,
    }) => {
      const { baseUrl, createConfidentialClient } = await setup();
      const { client } = await createConfidentialClient();

      const url = new URL(`${baseUrl}/oauth2/authorize`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", client.clientId);
      url.searchParams.set("redirect_uri", "http://localhost:3000/callback");
      url.searchParams.set(
        "code_challenge",
        "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      );
      url.searchParams.set("code_challenge_method", "S256");

      const resp = await fetch(url.toString(), { redirect: "manual" });

      expect(resp.status).toBe(301);
      const location = resp.headers.get("location");
      expect(location).toContain("/auth/login");
      expect(location).toContain("r=");
    });

    it("should return error for missing client_id", async ({ expect }) => {
      const { baseUrl } = await setup();

      const url = new URL(`${baseUrl}/oauth2/authorize`);
      url.searchParams.set("response_type", "code");

      const resp = await fetch(url.toString(), { redirect: "manual" });

      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toBe("invalid_request");
    });

    it("should return error for unsupported response_type", async ({
      expect,
    }) => {
      const { baseUrl, createConfidentialClient } = await setup();
      const { client } = await createConfidentialClient();

      const url = new URL(`${baseUrl}/oauth2/authorize`);
      url.searchParams.set("response_type", "token");
      url.searchParams.set("client_id", client.clientId);
      url.searchParams.set("redirect_uri", "http://localhost:3000/callback");

      const resp = await fetch(url.toString(), { redirect: "manual" });

      // Should redirect with error since redirect_uri is valid
      expect(resp.status).toBe(301);
      const location = resp.headers.get("location");
      expect(location).toContain("error=unsupported_response_type");
    });

    it("should return error for missing PKCE code_challenge", async ({
      expect,
    }) => {
      const { baseUrl, createConfidentialClient } = await setup();
      const { client } = await createConfidentialClient();

      const url = new URL(`${baseUrl}/oauth2/authorize`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", client.clientId);
      url.searchParams.set("redirect_uri", "http://localhost:3000/callback");

      const resp = await fetch(url.toString(), { redirect: "manual" });

      // Error redirected to redirect_uri since it's valid
      expect(resp.status).toBe(301);
      const location = resp.headers.get("location");
      expect(location).toContain("error=invalid_request");
      expect(location).toContain("code_challenge");
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------
  // Discovery Metadata
  // -----------------------------------------------------------------------------------------------------------------------

  describe("GET /.well-known/oauth-authorization-server", () => {
    it("should return valid AS metadata", async ({ expect }) => {
      const { baseUrl } = await setup();

      const resp = await fetch(
        `${baseUrl}/.well-known/oauth-authorization-server`,
      );

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.issuer).toBe(baseUrl);
      expect(body.authorization_endpoint).toBe(`${baseUrl}/oauth2/authorize`);
      expect(body.token_endpoint).toBe(`${baseUrl}/oauth2/token`);
      expect(body.revocation_endpoint).toBe(`${baseUrl}/oauth2/revoke`);
      expect(body.introspection_endpoint).toBe(`${baseUrl}/oauth2/introspect`);
      expect(body.jwks_uri).toBe(`${baseUrl}/.well-known/jwks.json`);
      expect(body.response_types_supported).toEqual(["code"]);
      expect(body.grant_types_supported).toContain("authorization_code");
      expect(body.grant_types_supported).toContain("client_credentials");
      expect(body.grant_types_supported).toContain("refresh_token");
      expect(body.code_challenge_methods_supported).toEqual(["S256"]);
      expect(body.token_endpoint_auth_methods_supported).toContain("none");
      expect(body.token_endpoint_auth_methods_supported).toContain(
        "client_secret_basic",
      );
      expect(body.token_endpoint_auth_methods_supported).toContain(
        "client_secret_post",
      );
      expect(body.scopes_supported).toBeDefined();
    });
  });

  describe("GET /.well-known/openid-configuration", () => {
    it("should return same metadata as AS endpoint", async ({ expect }) => {
      const { baseUrl } = await setup();

      const asResp = await fetch(
        `${baseUrl}/.well-known/oauth-authorization-server`,
      );
      const oidcResp = await fetch(
        `${baseUrl}/.well-known/openid-configuration`,
      );

      expect(asResp.status).toBe(200);
      expect(oidcResp.status).toBe(200);

      const asBody = await asResp.json();
      const oidcBody = await oidcResp.json();
      expect(asBody).toEqual(oidcBody);
    });
  });

  describe("GET /.well-known/oauth-protected-resource", () => {
    it("should return protected resource metadata", async ({ expect }) => {
      const { baseUrl } = await setup();

      const resp = await fetch(
        `${baseUrl}/.well-known/oauth-protected-resource`,
      );

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.resource).toBe(baseUrl);
      expect(body.authorization_servers).toEqual([baseUrl]);
      expect(body.bearer_methods_supported).toEqual(["header"]);
      expect(body.scopes_supported).toBeDefined();
    });
  });

  describe("GET /.well-known/jwks.json", () => {
    it("should return empty keyset", async ({ expect }) => {
      const { baseUrl } = await setup();

      const resp = await fetch(`${baseUrl}/.well-known/jwks.json`);

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body).toEqual({ keys: [] });
    });
  });
});
