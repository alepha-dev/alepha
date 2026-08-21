import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, test } from "vitest";

import { $issuer, currentTenantAtom, SecurityProvider } from "../index.ts";

describe("$issuer federated tokens", () => {
  /**
   * The `typ: "access"` requirement (see `JwtProvider.isAccessToken`) must
   * apply ONLY to realms we sign for. An external IdP picks its own `typ` —
   * Keycloak sends `Bearer`, most OIDC providers send `JWT` — so enforcing
   * ours here would reject every federated token, which is how relying
   * parties that forward an id_token as their Bearer authenticate.
   */
  test("accepts an external IdP token whose typ is not ours", async ({
    expect,
  }) => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", {
      extractable: true,
    });
    const jwk = { ...(await exportJWK(publicKey)), kid: "idp-1", alg: "RS256" };

    class App {
      issuer = $issuer({ name: "federated", jwks: { keys: [jwk] } });
    }

    const alepha = Alepha.create();
    alepha.inject(App);
    await alepha.start();

    const token = await new SignJWT({ sub: "external-user", roles: [] })
      .setProtectedHeader({ alg: "RS256", kid: "idp-1", typ: "JWT" })
      .setExpirationTime("1h")
      .sign(privateKey);

    const user = await alepha
      .inject(SecurityProvider)
      .resolveUserFromServerRequest({
        url: new URL("https://app.com/api"),
        headers: { authorization: `Bearer ${token}` },
      });

    expect(user?.id).toBe("external-user");
  });
});

describe("$issuer", () => {
  const roles = [
    {
      name: "admin",
      permissions: [{ name: "*" }],
    },
    {
      name: "user",
      permissions: [{ name: "read" }],
    },
  ];

  test("should create token (access & refresh)", async ({ expect }) => {
    class App {
      issuer = $issuer({
        secret: "test",
        roles,
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    const user = {
      id: randomUUID(),
      name: "Test User",
      roles: ["admin", "user"],
    };

    const dt = alepha.inject(DateTimeProvider);
    await alepha.start();

    const now = dt.pause();

    const token = await app.issuer.createToken(user);

    expect(token).toEqual({
      access_token: expect.any(String),
      expires_in: app.issuer.accessTokenExpiration.asSeconds(),
      refresh_token: expect.any(String),
      token_type: "Bearer",
      issued_at: now.unix(),
      refresh_token_expires_in: app.issuer.refreshTokenExpiration.asSeconds(),
    });

    expect(
      JSON.parse(
        Buffer.from(token.access_token.split(".")[1], "base64").toString(),
      ),
    ).toEqual({
      sub: user.id,
      aud: app.issuer.name,
      iat: now.unix(),
      exp: now.unix() + app.issuer.accessTokenExpiration.asSeconds(),
      name: user.name,
      roles: ["admin", "user"],
      sid: expect.any(String),
    });

    expect(
      JSON.parse(
        Buffer.from(
          token.refresh_token?.split(".")?.[1] || "",
          "base64",
        ).toString(),
      ),
    ).toEqual({
      sub: user.id,
      aud: app.issuer.name,
      iat: now.unix(),
      exp: now.unix() + app.issuer.refreshTokenExpiration.asSeconds(),
    });

    expect(
      JSON.parse(
        Buffer.from(
          token.refresh_token?.split(".")?.[0] || "",
          "base64",
        ).toString(),
      ),
    ).toEqual({
      alg: "HS256",
      typ: "refresh",
    });

    const newToken = await app.issuer.createToken(user, token);
    expect(newToken).toEqual({
      access_token: expect.any(String),
      issued_at: now.unix(),
      expires_in: dt.duration(15, "minutes").asSeconds(),
      refresh_token: token.refresh_token,
      refresh_token_expires_in: dt.duration(30, "days").asSeconds(),
      token_type: "Bearer",
    });
  });

  test("rejects a token minted on another tenant (issuer resolver path)", async ({
    expect,
  }) => {
    class App {
      issuer = $issuer({
        secret: "test",
        roles,
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    const securityProvider = alepha.inject(SecurityProvider);
    await alepha.start();

    // Mint a token while tenant A is active — it carries `tenant: "tenant-a"`.
    alepha.store.set(currentTenantAtom, { id: "tenant-a" });
    const token = await app.issuer.createToken({
      id: randomUUID(),
      roles: ["user"],
    });

    const request = {
      url: "http://localhost/",
      headers: { authorization: `Bearer ${token.access_token}` },
    };

    // Replaying it on tenant B must be refused.
    alepha.store.set(currentTenantAtom, { id: "tenant-b" });
    const rejected =
      await securityProvider.resolveUserFromServerRequest(request);
    expect(rejected).toBeUndefined();

    // The right tenant still works.
    alepha.store.set(currentTenantAtom, { id: "tenant-a" });
    const accepted =
      await securityProvider.resolveUserFromServerRequest(request);
    expect(accepted?.id).toBeDefined();
  });
});
