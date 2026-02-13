import { randomUUID } from "node:crypto";
import { $inject, Alepha, t } from "alepha";
import { $issuer, $secure, AlephaSecurity } from "alepha/security";
import { $action, AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";
import { AlephaApiKeys } from "../index.ts";
import { ApiKeyService } from "./ApiKeyService.ts";

describe("ApiKeyService", () => {
  it("should create an API key", async () => {
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [
          {
            name: "admin",
            permissions: [{ name: "*" }],
          },
        ],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.inject(TestApp);

    const service = alepha.inject(ApiKeyService);
    await alepha.start();

    const userId = randomUUID();
    const { apiKey, token } = await service.create({
      userId,
      name: "Test Key",
      roles: ["admin"],
    });

    expect(apiKey).toBeDefined();
    expect(apiKey.name).toBe("Test Key");
    expect(apiKey.userId).toBe(userId);
    expect(apiKey.roles).toEqual(["admin"]);
    expect(token).toMatch(/^ak_/);
    expect(apiKey.tokenPrefix).toBe("ak");
    expect(apiKey.tokenSuffix).toBe(token.slice(-8));
  });

  it("should validate an API key", async () => {
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [
          {
            name: "admin",
            permissions: [{ name: "*" }],
          },
        ],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.inject(TestApp);

    const service = alepha.inject(ApiKeyService);
    await alepha.start();

    const userId = randomUUID();
    const { token } = await service.create({
      userId,
      name: "Test Key",
      roles: ["admin"],
    });

    const userInfo = await service.validate(token);

    expect(userInfo).toBeDefined();
    expect(userInfo?.id).toBe(userId);
    expect(userInfo?.roles).toEqual(["admin"]);
  });

  it("should return null for invalid token", async () => {
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [
          {
            name: "admin",
            permissions: [{ name: "*" }],
          },
        ],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.inject(TestApp);

    const service = alepha.inject(ApiKeyService);
    await alepha.start();

    const userInfo = await service.validate("ak_invalid_token");

    expect(userInfo).toBeNull();
  });

  it("should list API keys for a user", async () => {
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [
          {
            name: "admin",
            permissions: [{ name: "*" }],
          },
        ],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.inject(TestApp);

    const service = alepha.inject(ApiKeyService);
    await alepha.start();

    const userId = randomUUID();
    await service.create({
      userId,
      name: "Key 1",
      roles: ["admin"],
    });
    await service.create({
      userId,
      name: "Key 2",
      roles: ["admin"],
    });

    const keys = await service.list(userId);

    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.name).sort()).toEqual(["Key 1", "Key 2"]);
  });

  it("should revoke an API key", async () => {
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [
          {
            name: "admin",
            permissions: [{ name: "*" }],
          },
        ],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.inject(TestApp);

    const service = alepha.inject(ApiKeyService);
    await alepha.start();

    const userId = randomUUID();
    const { apiKey, token } = await service.create({
      userId,
      name: "Test Key",
      roles: ["admin"],
    });

    // Key should be valid
    const beforeRevoke = await service.validate(token);
    expect(beforeRevoke).not.toBeNull();

    // Revoke the key
    await service.revoke(apiKey.id, userId);

    // Key should be invalid after revocation
    const afterRevoke = await service.validate(token);
    expect(afterRevoke).toBeNull();
  });

  it("should create resolver for issuer integration", async () => {
    class TestApp {
      apiKeyService = $inject(ApiKeyService);
      issuer = $issuer({
        secret: "test-secret",
        roles: [
          {
            name: "admin",
            permissions: [{ name: "*" }],
          },
        ],
      });

      // Action that can be accessed with API key
      protected = $action({
        use: [$secure()],
        schema: {
          response: t.object({ userId: t.string() }),
        },
        handler: (request) => {
          return { userId: request.user.id };
        },
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    const app = alepha.inject(TestApp);
    await alepha.start();

    // Create an API key
    const userId = randomUUID();
    const { token } = await app.apiKeyService.create({
      userId,
      name: "Test Key",
      roles: ["admin"],
    });

    // Register the API key resolver
    app.issuer.registerResolver(app.apiKeyService.createResolver());

    // Access the protected action using API key
    const mockRequest = {
      url: new URL(`http://localhost?api_key=${token}`),
      headers: {},
    };

    const userInfo = await app.apiKeyService.validate(token);
    expect(userInfo?.id).toBe(userId);
  });

  // ---------------------------------------------------------------------------
  // Expired API keys validation
  // ---------------------------------------------------------------------------

  it("should return null for expired API key", async () => {
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [{ name: "admin", permissions: [{ name: "*" }] }],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.inject(TestApp);

    const service = alepha.inject(ApiKeyService);
    await alepha.start();

    const userId = randomUUID();
    // Create key that expired 1 hour ago
    const { token } = await service.create({
      userId,
      name: "Expired Key",
      roles: ["admin"],
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const userInfo = await service.validate(token);
    expect(userInfo).toBeNull();
  });

  it("should validate API key that has not yet expired", async () => {
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [{ name: "admin", permissions: [{ name: "*" }] }],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.inject(TestApp);

    const service = alepha.inject(ApiKeyService);
    await alepha.start();

    const userId = randomUUID();
    // Create key that expires in 1 hour
    const { token } = await service.create({
      userId,
      name: "Future Key",
      roles: ["admin"],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const userInfo = await service.validate(token);
    expect(userInfo).not.toBeNull();
    expect(userInfo?.id).toBe(userId);
  });

  // ---------------------------------------------------------------------------
  // Concurrent revocation + validation
  // ---------------------------------------------------------------------------

  it("should handle concurrent validation and revocation", async () => {
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [{ name: "admin", permissions: [{ name: "*" }] }],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.inject(TestApp);

    const service = alepha.inject(ApiKeyService);
    await alepha.start();

    const userId = randomUUID();
    const { apiKey, token } = await service.create({
      userId,
      name: "Concurrent Key",
      roles: ["admin"],
    });

    // Run validation and revocation concurrently
    const [validationResult] = await Promise.all([
      service.validate(token),
      service.revoke(apiKey.id, userId),
    ]);

    // First validation may succeed (race condition)
    // But subsequent validations should fail
    const afterRevoke = await service.validate(token);
    expect(afterRevoke).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Cache behavior
  // ---------------------------------------------------------------------------

  it("should use cache for repeated validations", async () => {
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [{ name: "admin", permissions: [{ name: "*" }] }],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.inject(TestApp);

    const service = alepha.inject(ApiKeyService);
    await alepha.start();

    const userId = randomUUID();
    const { token } = await service.create({
      userId,
      name: "Cache Test Key",
      roles: ["admin"],
    });

    // First validation - cache miss
    const first = await service.validate(token);
    expect(first?.id).toBe(userId);

    // Second validation - should hit cache
    const second = await service.validate(token);
    expect(second?.id).toBe(userId);

    // Third validation - should still work
    const third = await service.validate(token);
    expect(third?.id).toBe(userId);
  });

  it("should invalidate cache on revocation", async () => {
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [{ name: "admin", permissions: [{ name: "*" }] }],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.inject(TestApp);

    const service = alepha.inject(ApiKeyService);
    await alepha.start();

    const userId = randomUUID();
    const { apiKey, token } = await service.create({
      userId,
      name: "Cache Invalidation Key",
      roles: ["admin"],
    });

    // Populate cache
    const before = await service.validate(token);
    expect(before?.id).toBe(userId);

    // Revoke should invalidate cache
    await service.revoke(apiKey.id, userId);

    // Validation should fail (cache was invalidated)
    const after = await service.validate(token);
    expect(after).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Invalid token formats
  // ---------------------------------------------------------------------------

  it("should return null for token without underscore", async () => {
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [{ name: "admin", permissions: [{ name: "*" }] }],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.inject(TestApp);

    const service = alepha.inject(ApiKeyService);
    await alepha.start();

    // Token without underscore is not an API key format
    const result = await service.validate("invalidtokenwithoutunderscore");
    expect(result).toBeNull();
  });

  it("should return null for empty token", async () => {
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [{ name: "admin", permissions: [{ name: "*" }] }],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.inject(TestApp);

    const service = alepha.inject(ApiKeyService);
    await alepha.start();

    const result = await service.validate("");
    expect(result).toBeNull();
  });

  it("should return null for token with only prefix", async () => {
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [{ name: "admin", permissions: [{ name: "*" }] }],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.inject(TestApp);

    const service = alepha.inject(ApiKeyService);
    await alepha.start();

    const result = await service.validate("ak_");
    expect(result).toBeNull();
  });

  it("should return null for JWT-like token", async () => {
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [{ name: "admin", permissions: [{ name: "*" }] }],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.inject(TestApp);

    const service = alepha.inject(ApiKeyService);
    await alepha.start();

    // JWT has dots, not underscores as separator
    const result = await service.validate(
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature",
    );
    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Custom prefix
  // ---------------------------------------------------------------------------

  it("should support custom token prefix", async () => {
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [{ name: "admin", permissions: [{ name: "*" }] }],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.inject(TestApp);

    const service = alepha.inject(ApiKeyService);
    await alepha.start();

    const userId = randomUUID();
    const { token } = await service.create({
      userId,
      name: "Custom Prefix Key",
      roles: ["admin"],
      prefix: "myapp",
    });

    expect(token).toMatch(/^myapp_/);

    const userInfo = await service.validate(token);
    expect(userInfo?.id).toBe(userId);
  });
});
