import { randomUUID } from "node:crypto";

import { $inject, Alepha, z } from "alepha";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $issuer, $secure, AlephaSecurity } from "alepha/security";
import { $action, AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { users } from "../../users/entities/users.ts";
import { AdminApiKeyController } from "../controllers/AdminApiKeyController.ts";
import { AlephaApiKeys } from "../index.ts";
import { ApiKeyService } from "../services/ApiKeyService.ts";

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
      .with(AlephaOrmPostgres)
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
      .with(AlephaOrmPostgres)
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
      .with(AlephaOrmPostgres)
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
      .with(AlephaOrmPostgres)
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
      .with(AlephaOrmPostgres)
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
          response: z.object({ userId: z.string() }),
        },
        handler: (request) => {
          return { userId: request.user.id };
        },
      });
    }

    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
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
      .with(AlephaOrmPostgres)
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
      .with(AlephaOrmPostgres)
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

  it("should not resurrect a revoked key from an in-flight validation", async () => {
    // The failure CI kept hitting, made deterministic. `revoke()` invalidated
    // the cache and then wrote the row, so a validation that had already read
    // the pre-revocation row wrote it back afterwards — and the revoked key
    // kept authenticating for the full 15-minute TTL.
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [{ name: "admin", permissions: [{ name: "*" }] }],
      });
    }

    let releaseRead: () => void = () => {};
    const readReached = Promise.withResolvers<void>();
    const mayFinishRead = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });

    /** Holds the DB read open so a revocation can land in the middle of it. */
    class RacingApiKeyService extends ApiKeyService {
      public raceNextRead = false;

      protected async findByTokenHash(hash: string) {
        const row = await super.findByTokenHash(hash);
        if (this.raceNextRead) {
          this.raceNextRead = false;
          readReached.resolve();
          await mayFinishRead;
        }
        return row;
      }
    }

    const alepha = Alepha.create()
      .with({ provide: ApiKeyService, use: RacingApiKeyService })
      .with(AlephaOrmPostgres)
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.inject(TestApp);

    const service = alepha.inject(RacingApiKeyService);
    await alepha.start();

    const userId = randomUUID();
    const { apiKey, token } = await service.create({
      userId,
      name: "Raced Key",
      roles: ["admin"],
    });

    // 1. A validation reads the (still valid) row and stops before caching.
    service.raceNextRead = true;
    const inFlight = service.validate(token);
    await readReached.promise;

    // 2. The key is revoked while that validation is in flight.
    await service.revoke(apiKey.id, userId);

    // 3. The validation resumes and would cache the row it read in step 1.
    releaseRead();
    await inFlight;

    // 4. Every later validation must see the revocation.
    expect(await service.validate(token)).toBeNull();
  });

  it("should handle concurrent validation and revocation", async () => {
    class TestApp {
      issuer = $issuer({
        secret: "test-secret",
        roles: [{ name: "admin", permissions: [{ name: "*" }] }],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
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

    // Run validation and revocation concurrently. The validation may or may
    // not win the race, so only what comes after is asserted.
    await Promise.all([
      service.validate(token),
      service.revoke(apiKey.id, userId),
    ]);

    // Subsequent validations must fail.
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
      .with(AlephaOrmPostgres)
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
      .with(AlephaOrmPostgres)
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
      .with(AlephaOrmPostgres)
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
      .with(AlephaOrmPostgres)
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
      .with(AlephaOrmPostgres)
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
      .with(AlephaOrmPostgres)
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
      .with(AlephaOrmPostgres)
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

  // ---------------------------------------------------------------------------
  // Admin listing owner enrichment
  // ---------------------------------------------------------------------------

  it("embeds the owner summary when a users repository is registered", async () => {
    // Registering a users repository is what flips the best-effort join on
    // (and creates the `users` table) — same mechanism as the files module's
    // uploader join. The other tests in this file run without it and confirm
    // findAll still works with `user` simply absent.
    class TestApp {
      users = $repository(users);
      issuer = $issuer({
        secret: "test-secret",
        roles: [{ name: "admin", permissions: [{ name: "*" }] }],
      });
    }

    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    const app = alepha.inject(TestApp);

    const service = alepha.inject(ApiKeyService);
    const controller = alepha.inject(AdminApiKeyController);
    await alepha.start();

    const ownerId = randomUUID();
    const strangerId = randomUUID();
    await app.users.create({
      id: ownerId,
      email: "owner@example.com",
      username: "owner",
    });
    await service.create({ userId: ownerId, name: "Known owner", roles: [] });
    await service.create({
      userId: strangerId,
      name: "Deleted owner",
      roles: [],
    });

    // Through the controller rather than the service, so the response schema
    // is exercised too — a summary the schema fails to declare would vanish
    // silently from the payload.
    const page = await controller.findApiKeys.run(
      { query: {} },
      { user: { id: randomUUID(), name: "Admin", roles: ["admin"] } },
    );

    // Matched by our own ids — the test database is shared across specs, so
    // absolute counts would race with whatever other tests created.
    const known = page.content.find((row) => row.userId === ownerId);
    const unknown = page.content.find((row) => row.userId === strangerId);
    expect(known?.user?.email).toBe("owner@example.com");
    expect(known?.user?.username).toBe("owner");
    // A deleted owner stays a bare id: the left join leaves `user` undefined.
    expect(unknown).toBeDefined();
    expect(unknown?.user).toBeUndefined();
  });
});
