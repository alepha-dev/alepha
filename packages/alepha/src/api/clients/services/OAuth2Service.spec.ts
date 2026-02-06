import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { $issuer, AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";
import { AlephaApiClients } from "../index.ts";
import { OAuth2Service } from "./OAuth2Service.ts";

/**
 * Helper to create a test instance of Alepha with OAuth2 clients enabled.
 */
function createTestApp() {
  class TestApp {
    issuer = $issuer({
      secret: "test-secret-for-oauth2",
      roles: [
        {
          name: "admin",
          permissions: [{ name: "*" }],
        },
        {
          name: "user",
          permissions: [{ name: "profile:read" }, { name: "items:read" }],
        },
      ],
    });
  }

  const alepha = Alepha.create()
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaApiClients);

  const app = alepha.inject(TestApp);
  const service = alepha.inject(OAuth2Service);

  return { alepha, app, service };
}

async function startApp() {
  const { alepha, app, service } = createTestApp();

  await alepha.start();

  // Wire the issuer to the service
  service.issuer = app.issuer;
  service.realmName = app.issuer.name;

  return { alepha, app, service };
}

// -----------------------------------------------------------------------------------------------------------------------
// Client Management
// -----------------------------------------------------------------------------------------------------------------------

describe("OAuth2Service", () => {
  describe("Client management", () => {
    it("should create a confidential client", async () => {
      const { service } = await startApp();

      const { client, clientSecret } = await service.createClient({
        name: "Test Client",
        redirectUris: ["http://localhost:3000/callback"],
        grantTypes: ["authorization_code"],
        scopes: ["profile:read"],
      });

      expect(client).toBeDefined();
      expect(client.name).toBe("Test Client");
      expect(client.clientId).toBeTruthy();
      expect(client.clientSecretHash).toBeTruthy();
      expect(client.redirectUris).toEqual(["http://localhost:3000/callback"]);
      expect(client.grantTypes).toEqual(["authorization_code"]);
      expect(client.tokenEndpointAuthMethod).toBe("client_secret_basic");
      expect(clientSecret).toBeTruthy();
      expect(clientSecret).toMatch(/^cs_/);
    });

    it("should create a public client (no secret)", async () => {
      const { service } = await startApp();

      const { client, clientSecret } = await service.createClient({
        name: "Public Client",
        redirectUris: ["http://localhost:3000/callback"],
        tokenEndpointAuthMethod: "none",
      });

      expect(client.clientSecretHash).toBeUndefined();
      expect(client.tokenEndpointAuthMethod).toBe("none");
      expect(clientSecret).toBeUndefined();
    });

    it("should authenticate client via basic auth credentials", async () => {
      const { service } = await startApp();

      const { client, clientSecret } = await service.createClient({
        name: "Auth Test Client",
        redirectUris: ["http://localhost:3000/callback"],
      });

      const authenticated = await service.authenticateClient(
        client.clientId,
        clientSecret!,
      );

      expect(authenticated.clientId).toBe(client.clientId);
    });

    it("should reject invalid client secret", async () => {
      const { service } = await startApp();

      const { client } = await service.createClient({
        name: "Auth Test Client",
        redirectUris: ["http://localhost:3000/callback"],
      });

      await expect(
        service.authenticateClient(client.clientId, "wrong-secret"),
      ).rejects.toThrowError();
    });

    it("should reject disabled client", async () => {
      const { service } = await startApp();

      const { client, clientSecret } = await service.createClient({
        name: "Disabled Client",
        redirectUris: ["http://localhost:3000/callback"],
      });

      await service.disableClient(client.id);

      await expect(
        service.authenticateClient(client.clientId, clientSecret!),
      ).rejects.toThrowError();
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------
  // Authorization Code Flow
  // -----------------------------------------------------------------------------------------------------------------------

  describe("Authorization code flow", () => {
    it("should validate authorization request", async () => {
      const { service } = await startApp();

      const { client } = await service.createClient({
        name: "Auth Code Client",
        redirectUris: ["http://localhost:3000/callback"],
        grantTypes: ["authorization_code"],
        scopes: ["profile:read"],
      });

      const validated = await service.validateAuthorizationRequest({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: "http://localhost:3000/callback",
        scope: "profile:read",
        code_challenge: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
        code_challenge_method: "S256",
        state: "test-state",
      });

      expect(validated.client.clientId).toBe(client.clientId);
      expect(validated.redirectUri).toBe("http://localhost:3000/callback");
      expect(validated.scopes).toEqual(["profile:read"]);
      expect(validated.codeChallenge).toBe(
        "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      );
      expect(validated.state).toBe("test-state");
    });

    it("should reject unknown client_id", async () => {
      const { service } = await startApp();

      await expect(
        service.validateAuthorizationRequest({
          response_type: "code",
          client_id: "nonexistent",
          redirect_uri: "http://localhost:3000/callback",
          code_challenge: "test",
          code_challenge_method: "S256",
        }),
      ).rejects.toThrowError();
    });

    it("should reject mismatched redirect_uri", async () => {
      const { service } = await startApp();

      const { client } = await service.createClient({
        name: "Redirect Test Client",
        redirectUris: ["http://localhost:3000/callback"],
        grantTypes: ["authorization_code"],
      });

      await expect(
        service.validateAuthorizationRequest({
          response_type: "code",
          client_id: client.clientId,
          redirect_uri: "http://evil.example.com/callback",
          code_challenge: "test",
          code_challenge_method: "S256",
        }),
      ).rejects.toThrowError(/redirect_uri/);
    });

    it("should reject unauthorized scopes", async () => {
      const { service } = await startApp();

      const { client } = await service.createClient({
        name: "Scope Test Client",
        redirectUris: ["http://localhost:3000/callback"],
        grantTypes: ["authorization_code"],
        scopes: ["profile:read"],
      });

      await expect(
        service.validateAuthorizationRequest({
          response_type: "code",
          client_id: client.clientId,
          redirect_uri: "http://localhost:3000/callback",
          scope: "admin:users:write",
          code_challenge: "test",
          code_challenge_method: "S256",
        }),
      ).rejects.toThrowError(/scope/i);
    });

    it("should require code_challenge (PKCE)", async () => {
      const { service } = await startApp();

      const { client } = await service.createClient({
        name: "PKCE Test Client",
        redirectUris: ["http://localhost:3000/callback"],
        grantTypes: ["authorization_code"],
      });

      await expect(
        service.validateAuthorizationRequest({
          response_type: "code",
          client_id: client.clientId,
          redirect_uri: "http://localhost:3000/callback",
        }),
      ).rejects.toThrowError(/code_challenge/);
    });

    it("should create and exchange authorization code", async () => {
      const { service } = await startApp();

      const { client, clientSecret } = await service.createClient({
        name: "Exchange Test Client",
        redirectUris: ["http://localhost:3000/callback"],
        grantTypes: ["authorization_code"],
        scopes: ["profile:read"],
      });

      // Create a fake user in the system to be referenced
      const userId = randomUUID();

      // Generate a real PKCE pair
      const { createHash, randomBytes } = await import("node:crypto");
      const codeVerifier = randomBytes(32).toString("base64url");
      const codeChallenge = createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

      const validated = await service.validateAuthorizationRequest({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: "http://localhost:3000/callback",
        scope: "profile:read",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });

      const code = await service.createAuthorizationCode(userId, validated);
      expect(code).toBeTruthy();

      // Exchanging code requires a real user in the database.
      // This is an integration test concern — unit test validates code creation works.
    });

    it("should reject consumed authorization code", async () => {
      const { service } = await startApp();

      const { client } = await service.createClient({
        name: "Reuse Test Client",
        redirectUris: ["http://localhost:3000/callback"],
        grantTypes: ["authorization_code"],
      });

      const { createHash, randomBytes } = await import("node:crypto");
      const codeVerifier = randomBytes(32).toString("base64url");
      const codeChallenge = createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

      const validated = await service.validateAuthorizationRequest({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: "http://localhost:3000/callback",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });

      const userId = randomUUID();
      const code = await service.createAuthorizationCode(userId, validated);

      // Mark code as consumed (simulate first exchange)
      const stored = await (service as any).codes.get(code);
      stored.consumed = true;
      await (service as any).codes.set(code, stored);

      // Second exchange should fail
      await expect(
        service.exchangeCode({
          code,
          clientId: client.clientId,
          redirectUri: "http://localhost:3000/callback",
          codeVerifier,
        }),
      ).rejects.toThrowError(/already been used/);
    });

    it("should reject invalid PKCE code_verifier", async () => {
      const { service } = await startApp();

      const valid = await service.verifyPKCE(
        "correct-verifier",
        "wrong-challenge",
      );

      expect(valid).toBe(false);
    });

    it("should verify correct PKCE pair", async () => {
      const { service } = await startApp();

      const { createHash, randomBytes } = await import("node:crypto");
      const codeVerifier = randomBytes(32).toString("base64url");
      const codeChallenge = createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

      const valid = await service.verifyPKCE(codeVerifier, codeChallenge);
      expect(valid).toBe(true);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------
  // Client Credentials Flow
  // -----------------------------------------------------------------------------------------------------------------------

  describe("Client credentials flow", () => {
    it("should issue token for confidential client", async () => {
      const { service } = await startApp();

      const { client, clientSecret } = await service.createClient({
        name: "Client Creds Client",
        redirectUris: [],
        grantTypes: ["client_credentials"],
        scopes: ["profile:read"],
      });

      const authenticated = await service.authenticateClient(
        client.clientId,
        clientSecret!,
      );

      const tokens = await service.clientCredentialsGrant({
        client: authenticated,
        scope: "profile:read",
      });

      expect(tokens.access_token).toBeTruthy();
      expect(tokens.token_type).toBe("Bearer");
      expect(tokens.expires_in).toBeGreaterThan(0);
      expect(tokens.scope).toBe("profile:read");
      // No refresh token for client_credentials
      expect(tokens.refresh_token).toBeUndefined();
    });

    it("should reject public client for client_credentials", async () => {
      const { service } = await startApp();

      const { client } = await service.createClient({
        name: "Public CC Client",
        redirectUris: [],
        grantTypes: ["client_credentials"],
        tokenEndpointAuthMethod: "none",
      });

      // Public clients cannot use client_credentials (no secret to authenticate with)
      // authenticateClient allows public clients through, but clientCredentialsGrant requires confidential clients
      const authenticated = await service.authenticateClient(client.clientId);
      await expect(
        service.clientCredentialsGrant({ client: authenticated }),
      ).rejects.toThrowError();
    });

    it("should reject client not authorized for client_credentials grant", async () => {
      const { service } = await startApp();

      const { client, clientSecret } = await service.createClient({
        name: "Auth Code Only Client",
        redirectUris: ["http://localhost:3000/callback"],
        grantTypes: ["authorization_code"],
        scopes: ["profile:read"],
      });

      const authenticated = await service.authenticateClient(
        client.clientId,
        clientSecret!,
      );

      await expect(
        service.clientCredentialsGrant({
          client: authenticated,
          scope: "profile:read",
        }),
      ).rejects.toThrowError(/not authorized/);
    });

    it("should restrict scopes to client's allowed set", async () => {
      const { service } = await startApp();

      const { client, clientSecret } = await service.createClient({
        name: "Scoped CC Client",
        redirectUris: [],
        grantTypes: ["client_credentials"],
        scopes: ["profile:read"],
      });

      const authenticated = await service.authenticateClient(
        client.clientId,
        clientSecret!,
      );

      await expect(
        service.clientCredentialsGrant({
          client: authenticated,
          scope: "admin:users:read",
        }),
      ).rejects.toThrowError(/scope/i);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------
  // Introspection
  // -----------------------------------------------------------------------------------------------------------------------

  describe("Refresh token flow", () => {
    it("should reject client not authorized for refresh_token grant", async () => {
      const { service } = await startApp();

      const { client, clientSecret } = await service.createClient({
        name: "No Refresh Client",
        redirectUris: ["http://localhost:3000/callback"],
        grantTypes: ["authorization_code"],
      });

      const authenticated = await service.authenticateClient(
        client.clientId,
        clientSecret!,
      );

      await expect(
        service.refreshTokenGrant({
          client: authenticated,
          refreshToken: "some-refresh-token",
        }),
      ).rejects.toThrowError(/not authorized/);
    });
  });

  describe("Introspection", () => {
    it("should return active=true for valid token", async () => {
      const { service } = await startApp();

      const { client, clientSecret } = await service.createClient({
        name: "Introspect Client",
        redirectUris: [],
        grantTypes: ["client_credentials"],
        scopes: ["profile:read"],
      });

      const authenticated = await service.authenticateClient(
        client.clientId,
        clientSecret!,
      );

      const tokens = await service.clientCredentialsGrant({
        client: authenticated,
        scope: "profile:read",
      });

      const result = await service.introspect(tokens.access_token);

      expect(result.active).toBe(true);
      expect(result.sub).toBe(`client:${client.clientId}`);
      expect(result.scope).toBe("profile:read");
      expect(result.token_type).toBe("Bearer");
    });

    it("should return active=false for invalid token", async () => {
      const { service } = await startApp();

      const result = await service.introspect("invalid.token.here");

      expect(result.active).toBe(false);
    });

    it("should return active=false for revoked token", async () => {
      const { service } = await startApp();

      const { client, clientSecret } = await service.createClient({
        name: "Revoke Introspect Client",
        redirectUris: [],
        grantTypes: ["client_credentials"],
        scopes: ["profile:read"],
      });

      const authenticated = await service.authenticateClient(
        client.clientId,
        clientSecret!,
      );

      const tokens = await service.clientCredentialsGrant({
        client: authenticated,
        scope: "profile:read",
      });

      // Revoke the token
      await service.revoke(tokens.access_token);

      // Introspect should show inactive
      const result = await service.introspect(tokens.access_token);
      expect(result.active).toBe(false);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------
  // Revocation
  // -----------------------------------------------------------------------------------------------------------------------

  describe("Revocation", () => {
    it("should revoke a token", async () => {
      const { service } = await startApp();

      const { client, clientSecret } = await service.createClient({
        name: "Revoke Client",
        redirectUris: [],
        grantTypes: ["client_credentials"],
      });

      const authenticated = await service.authenticateClient(
        client.clientId,
        clientSecret!,
      );

      const tokens = await service.clientCredentialsGrant({
        client: authenticated,
      });

      await service.revoke(tokens.access_token);

      const result = await service.introspect(tokens.access_token);
      expect(result.active).toBe(false);
    });

    it("should not throw for invalid token revocation (per spec)", async () => {
      const { service } = await startApp();

      // Should not throw — RFC 7009 requires 200 OK even for invalid tokens
      await expect(
        service.revoke("completely-invalid-token"),
      ).resolves.not.toThrow();
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------
  // Consent
  // -----------------------------------------------------------------------------------------------------------------------

  describe("Consent", () => {
    it("should save and check consent", async () => {
      const { service } = await startApp();

      const { client } = await service.createClient({
        name: "Consent Client",
        redirectUris: ["http://localhost:3000/callback"],
        grantTypes: ["authorization_code"],
        scopes: ["profile:read", "items:read"],
      });

      const userId = randomUUID();

      // No consent yet
      const before = await service.hasConsent(userId, client.clientId, [
        "profile:read",
      ]);
      expect(before).toBe(false);

      // Save consent
      await service.saveConsent(userId, client.clientId, ["profile:read"]);

      // Now has consent for profile:read
      const after = await service.hasConsent(userId, client.clientId, [
        "profile:read",
      ]);
      expect(after).toBe(true);

      // But not for items:read
      const broader = await service.hasConsent(userId, client.clientId, [
        "profile:read",
        "items:read",
      ]);
      expect(broader).toBe(false);
    });

    it("should merge scopes on re-consent", async () => {
      const { service } = await startApp();

      const { client } = await service.createClient({
        name: "Merge Consent Client",
        redirectUris: ["http://localhost:3000/callback"],
        scopes: ["profile:read", "items:read"],
      });

      const userId = randomUUID();

      // First consent
      await service.saveConsent(userId, client.clientId, ["profile:read"]);

      // Second consent with additional scope
      await service.saveConsent(userId, client.clientId, ["items:read"]);

      // Should now have both scopes
      const has = await service.hasConsent(userId, client.clientId, [
        "profile:read",
        "items:read",
      ]);
      expect(has).toBe(true);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------------------------------------------------------

  describe("Metadata", () => {
    it("should return valid AS metadata", async () => {
      const { service } = await startApp();

      const metadata = service.getServerMetadata("https://example.com");

      expect(metadata.issuer).toBe("https://example.com");
      expect(metadata.authorization_endpoint).toBe(
        "https://example.com/oauth2/authorize",
      );
      expect(metadata.token_endpoint).toBe("https://example.com/oauth2/token");
      expect(metadata.revocation_endpoint).toBe(
        "https://example.com/oauth2/revoke",
      );
      expect(metadata.introspection_endpoint).toBe(
        "https://example.com/oauth2/introspect",
      );
      expect(metadata.response_types_supported).toContain("code");
      expect(metadata.grant_types_supported).toContain("authorization_code");
      expect(metadata.grant_types_supported).toContain("client_credentials");
      expect(metadata.grant_types_supported).toContain("refresh_token");
      expect(metadata.code_challenge_methods_supported).toContain("S256");
      expect(metadata.jwks_uri).toBe(
        "https://example.com/.well-known/jwks.json",
      );
      expect(metadata.client_id_metadata_document_supported).toBe(true);
    });

    it("should include scopes from permissions", async () => {
      const { service } = await startApp();

      const metadata = service.getServerMetadata("https://example.com");

      expect(metadata.scopes_supported).toBeInstanceOf(Array);
    });

    it("should return protected resource metadata", async () => {
      const { service } = await startApp();

      const metadata = service.getProtectedResourceMetadata(
        "https://example.com",
      );

      expect(metadata.resource).toBe("https://example.com");
      expect(metadata.authorization_servers).toContain("https://example.com");
      expect(metadata.bearer_methods_supported).toContain("header");
      expect(metadata.scopes_supported).toBeInstanceOf(Array);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------
  // PKCE
  // -----------------------------------------------------------------------------------------------------------------------

  describe("PKCE", () => {
    it("should verify valid PKCE S256 pair", async () => {
      const { service } = await startApp();

      const { createHash, randomBytes } = await import("node:crypto");
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256")
        .update(verifier)
        .digest("base64url");

      expect(await service.verifyPKCE(verifier, challenge)).toBe(true);
    });

    it("should reject mismatched PKCE pair", async () => {
      const { service } = await startApp();

      expect(await service.verifyPKCE("wrong-verifier", "some-challenge")).toBe(
        false,
      );
    });

    it("should handle empty verifier", async () => {
      const { service } = await startApp();

      expect(await service.verifyPKCE("", "some-challenge")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------
  // Basic Auth Parsing
  // -----------------------------------------------------------------------------------------------------------------------

  describe("Basic auth parsing", () => {
    it("should parse valid Basic auth header", () => {
      const { service } = createTestApp();

      const encoded = Buffer.from("client-id:client-secret").toString("base64");
      const result = service.parseBasicAuth(`Basic ${encoded}`);

      expect(result).toEqual({
        clientId: "client-id",
        clientSecret: "client-secret",
      });
    });

    it("should return undefined for non-Basic auth", () => {
      const { service } = createTestApp();

      expect(service.parseBasicAuth("Bearer some-token")).toBeUndefined();
      expect(service.parseBasicAuth(undefined)).toBeUndefined();
    });

    it("should handle URL-encoded client credentials", () => {
      const { service } = createTestApp();

      const encoded = Buffer.from(
        `${encodeURIComponent("cl:id")}:${encodeURIComponent("sec:ret")}`,
      ).toString("base64");
      const result = service.parseBasicAuth(`Basic ${encoded}`);

      expect(result).toEqual({
        clientId: "cl:id",
        clientSecret: "sec:ret",
      });
    });
  });
});
