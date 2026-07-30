import { createHash } from "node:crypto";
import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { JwtProvider } from "alepha/security";
import { describe, it } from "vitest";
import { oauthClientEntity } from "../entities/oauthClientEntity.ts";
import { OAuthClientService } from "../services/OAuthClientService.ts";

describe("oauthClientEntity", () => {
  it("declares the oauth_clients table", ({ expect }) => {
    expect(oauthClientEntity.name).toBe("oauth_clients");
  });
});

describe("OAuthClientService.register", () => {
  it("registers a public DCR client and returns a client_id", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const service = alepha.inject(OAuthClientService);
    await alepha.start();

    const client = await service.register({
      realm: "users",
      clientName: "Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
      scopes: ["mcp"],
    });

    expect(client.clientId).toMatch(/^mcp_/);
    expect(client.source).toBe("dcr");

    const found = await service.findByClientId(client.clientId);
    expect(found?.clientName).toBe("Claude");
  });

  it("rejects an unknown redirect_uri", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const service = alepha.inject(OAuthClientService);
    await alepha.start();

    const client = await service.register({
      realm: "users",
      clientName: "Claude",
      redirectUris: ["https://claude.ai/cb"],
      scopes: ["mcp"],
    });

    expect(service.isRedirectUriAllowed(client, "https://claude.ai/cb")).toBe(
      true,
    );
    expect(service.isRedirectUriAllowed(client, "https://evil.com/cb")).toBe(
      false,
    );
  });
});

describe("OAuthClientService wildcard redirect_uri", () => {
  const setup = async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const service = alepha.inject(OAuthClientService);
    await alepha.start();
    const client = await service.register({
      realm: "users",
      clientName: "Pooled Client",
      redirectUris: ["https://*.alepha.club/auth/callback"],
      scopes: ["openid"],
    });
    return { service, client };
  };

  it("matches exactly one host label", async ({ expect }) => {
    const { service, client } = await setup();

    expect(
      service.isRedirectUriAllowed(
        client,
        "https://b14.alepha.club/auth/callback",
      ),
    ).toBe(true);
    // The wildcard stands for a label, not for "zero or more labels".
    expect(
      service.isRedirectUriAllowed(client, "https://alepha.club/auth/callback"),
    ).toBe(false);
    expect(
      service.isRedirectUriAllowed(
        client,
        "https://a.b.alepha.club/auth/callback",
      ),
    ).toBe(false);
  });

  it("refuses candidates whose authority ends before the pattern's host", async ({
    expect,
  }) => {
    const { service, client } = await setup();

    // Every one of these parses to a host that is NOT under alepha.club: `/`,
    // `?`, `#` and `\` all terminate the authority in WHATWG URL parsing, so a
    // dot-free character class over the raw string is not a host check.
    for (const candidate of [
      "https://[2001:db8::1]/.alepha.club/auth/callback",
      "https://2130706433/.alepha.club/auth/callback",
      "https://evil?.alepha.club/auth/callback",
      "https://evil#.alepha.club/auth/callback",
      "https://evil\\.alepha.club/auth/callback",
    ]) {
      expect(
        service.isRedirectUriAllowed(client, candidate),
        `must not accept ${candidate}`,
      ).toBe(false);
    }
  });
});

describe("OAuthClientService.intersectScopes", () => {
  const setup = async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const service = alepha.inject(OAuthClientService);
    await alepha.start();
    return service;
  };

  it("drops requested scopes the client is not registered for", async ({
    expect,
  }) => {
    const service = await setup();
    // Client registered for ["mcp"] but asks for admin → admin is stripped.
    expect(service.intersectScopes(["mcp", "admin"], ["mcp"])).toEqual(["mcp"]);
  });

  it("falls back to the client's registered scopes when none requested", async ({
    expect,
  }) => {
    const service = await setup();
    expect(service.intersectScopes(undefined, ["mcp", "openid"])).toEqual([
      "mcp",
      "openid",
    ]);
    expect(service.intersectScopes([], ["mcp"])).toEqual(["mcp"]);
  });

  it("preserves requested order and de-duplicates", async ({ expect }) => {
    const service = await setup();
    expect(
      service.intersectScopes(["openid", "mcp", "openid"], ["mcp", "openid"]),
    ).toEqual(["openid", "mcp"]);
  });

  it("returns nothing when no requested scope is allowed", async ({
    expect,
  }) => {
    const service = await setup();
    expect(service.intersectScopes(["admin"], ["mcp"])).toEqual([]);
  });
});

describe("OAuthClientService authorization code", () => {
  it("mints and verifies a single-use auth code bound to PKCE", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const jwt = alepha.inject(JwtProvider);
    jwt.setKeyLoader("users", "test-secret-for-oauth-code-tests");
    const service = alepha.inject(OAuthClientService);
    await alepha.start();

    const verifier = "a".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");

    const code = await service.createAuthorizationCode("users", {
      userId: "user-1",
      clientId: "mcp_x",
      redirectUri: "https://claude.ai/cb",
      codeChallenge: challenge,
      scopes: ["mcp"],
      resource: "https://app.com/mcp",
    });

    const claims = await service.consumeAuthorizationCode("users", code, {
      clientId: "mcp_x",
      redirectUri: "https://claude.ai/cb",
      codeVerifier: verifier,
    });
    expect(claims.userId).toBe("user-1");

    await expect(
      service.consumeAuthorizationCode("users", code, {
        clientId: "mcp_x",
        redirectUri: "https://claude.ai/cb",
        codeVerifier: verifier,
      }),
    ).rejects.toThrow();
  });

  it("rejects a wrong PKCE verifier", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const jwt = alepha.inject(JwtProvider);
    jwt.setKeyLoader("users", "test-secret-for-oauth-code-tests");
    const service = alepha.inject(OAuthClientService);
    await alepha.start();

    const challenge = createHash("sha256")
      .update("a".repeat(64))
      .digest("base64url");
    const code = await service.createAuthorizationCode("users", {
      userId: "user-1",
      clientId: "mcp_x",
      redirectUri: "https://claude.ai/cb",
      codeChallenge: challenge,
      scopes: ["mcp"],
      resource: "https://app.com/mcp",
    });

    await expect(
      service.consumeAuthorizationCode("users", code, {
        clientId: "mcp_x",
        redirectUri: "https://claude.ai/cb",
        codeVerifier: "b".repeat(64),
      }),
    ).rejects.toThrow();
  });
});
