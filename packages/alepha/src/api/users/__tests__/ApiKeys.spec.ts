import { Alepha } from "alepha";
import { ApiKeyService } from "alepha/api/keys";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ForbiddenError } from "alepha/server";
import { describe, it } from "vitest";

import { $realm, AlephaApiUsers, SessionService } from "../index.ts";

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error" },
  });

  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);

  // Create a realm with API keys enabled
  class TestApp {
    realm = $realm({
      features: { apiKeys: true },
    });
  }

  alepha.inject(TestApp);
  await alepha.start();

  const sessionService = alepha.inject(SessionService);
  const apiKeyService = alepha.inject(ApiKeyService);
  const dateTimeProvider = alepha.inject(DateTimeProvider);

  return {
    alepha,
    sessionService,
    apiKeyService,
    dateTimeProvider,
  };
};

describe("alepha/api/users - API Keys Integration", () => {
  it("should create an API key for a user", async ({ expect }) => {
    const { sessionService, apiKeyService } = await setup();

    // Create a user
    const user = await sessionService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    // Create an API key
    const { apiKey, token } = await apiKeyService.create({
      userId: user.id,
      name: "My API Key",
      roles: ["user"],
    });

    expect(apiKey.name).toBe("My API Key");
    expect(apiKey.userId).toBe(user.id);
    expect(apiKey.roles).toEqual(["user"]);
    expect(token).toMatch(/^ak_/);
  });

  it("should validate API key and return user info", async ({ expect }) => {
    const { sessionService, apiKeyService } = await setup();

    // Create a user
    const user = await sessionService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    // Create an API key
    const { token } = await apiKeyService.create({
      userId: user.id,
      name: "My API Key",
      roles: ["user"],
    });

    // Validate the API key
    const userInfo = await apiKeyService.validate(token);

    expect(userInfo).not.toBeNull();
    expect(userInfo?.id).toBe(user.id);
    expect(userInfo?.roles).toEqual(["user"]);
  });

  it("should resolve user from API key in query param via resolver", async ({
    expect,
  }) => {
    const { sessionService, apiKeyService } = await setup();

    // Create a user
    const user = await sessionService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    // Create an API key
    const { token } = await apiKeyService.create({
      userId: user.id,
      name: "My API Key",
      roles: ["user"],
    });

    // Create resolver and test with query param
    const resolver = apiKeyService.createResolver();
    const userInfo = await resolver.onRequest({
      url: new URL(`http://localhost/profile?api_key=${token}`),
      headers: {},
    } as any);

    expect(userInfo).not.toBeNull();
    expect(userInfo?.id).toBe(user.id);
    expect(userInfo?.roles).toEqual(["user"]);
  });

  it("should resolve user from API key in Bearer header via resolver", async ({
    expect,
  }) => {
    const { sessionService, apiKeyService } = await setup();

    // Create a user
    const user = await sessionService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    // Create an API key
    const { token } = await apiKeyService.create({
      userId: user.id,
      name: "My API Key",
      roles: ["user"],
    });

    // Create resolver and test with Bearer header
    const resolver = apiKeyService.createResolver();
    const userInfo = await resolver.onRequest({
      url: new URL("http://localhost/profile"),
      headers: { authorization: `Bearer ${token}` },
    } as any);

    expect(userInfo).not.toBeNull();
    expect(userInfo?.id).toBe(user.id);
    expect(userInfo?.roles).toEqual(["user"]);
  });

  it("should not resolve JWT tokens as API keys", async ({ expect }) => {
    const { apiKeyService } = await setup();

    // Create resolver and test with a JWT-like token (contains dots)
    const resolver = apiKeyService.createResolver();
    const userInfo = await resolver.onRequest({
      url: new URL("http://localhost/profile"),
      headers: {
        authorization:
          "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature",
      },
    } as any);

    // Should return null because JWT tokens should be handled by JWT resolver
    expect(userInfo).toBeNull();
  });

  it("should update lastUsedAt and usageCount on validate", async ({
    expect,
  }) => {
    const { sessionService, apiKeyService } = await setup();

    const user = await sessionService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    const { apiKey, token } = await apiKeyService.create({
      userId: user.id,
      name: "My API Key",
      roles: ["user"],
    });
    expect(apiKey.usageCount).toBe(0);
    expect(apiKey.lastUsedAt).toBeUndefined();

    const info = await apiKeyService.validate(token);
    expect(info).not.toBeNull();

    // updateUsage is fire-and-forget — wait for the next microtask flush
    await new Promise((r) => setTimeout(r, 50));

    const after = await (apiKeyService as any).repo.getById(apiKey.id);
    expect(after.lastUsedAt).toBeDefined();
    expect(after.usageCount).toBe(1);
  });

  it("should reject revoked API key", async ({ expect }) => {
    const { sessionService, apiKeyService } = await setup();

    // Create a user
    const user = await sessionService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    // Create an API key
    const { apiKey, token } = await apiKeyService.create({
      userId: user.id,
      name: "My API Key",
      roles: ["user"],
    });

    // Verify key is valid
    const beforeRevoke = await apiKeyService.validate(token);
    expect(beforeRevoke).not.toBeNull();

    // Revoke the key
    await apiKeyService.revoke(apiKey.id, user.id);

    // Verify key is now invalid
    const afterRevoke = await apiKeyService.validate(token);
    expect(afterRevoke).toBeNull();
  });

  it("should reject expired API key", async ({ expect }) => {
    const { sessionService, apiKeyService, dateTimeProvider } = await setup();

    // Create a user
    const user = await sessionService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    // Create an API key that expires in 1 hour
    const expiresAt = dateTimeProvider.now().add(1, "hour").toDate();
    const { token } = await apiKeyService.create({
      userId: user.id,
      name: "Expiring Key",
      roles: ["user"],
      expiresAt,
    });

    // Verify key is valid
    const beforeExpiry = await apiKeyService.validate(token);
    expect(beforeExpiry).not.toBeNull();

    // Travel forward in time past expiry
    await dateTimeProvider.travel(2, "hours");

    // Verify key is now invalid
    const afterExpiry = await apiKeyService.validate(token);
    expect(afterExpiry).toBeNull();
  });

  it("should reject invalid API key", async ({ expect }) => {
    await setup();

    const { apiKeyService } = await setup();

    // Try to validate an invalid token
    const result = await apiKeyService.validate("ak_invalid_token_12345678");
    expect(result).toBeNull();
  });

  it("should list user's API keys", async ({ expect }) => {
    const { sessionService, apiKeyService } = await setup();

    // Create a user
    const user = await sessionService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    // Create multiple API keys
    await apiKeyService.create({
      userId: user.id,
      name: "Key 1",
      roles: ["user"],
    });
    await apiKeyService.create({
      userId: user.id,
      name: "Key 2",
      roles: ["user"],
    });

    // List keys
    const keys = await apiKeyService.list(user.id);

    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.name).sort()).toEqual(["Key 1", "Key 2"]);
  });

  it("should not allow revoking another user's API key", async ({ expect }) => {
    const { sessionService, apiKeyService } = await setup();

    // Create two users
    const user1 = await sessionService.users().create({
      username: "user1",
      email: "user1@example.com",
      roles: ["user"],
    });
    const user2 = await sessionService.users().create({
      username: "user2",
      email: "user2@example.com",
      roles: ["user"],
    });

    // Create an API key for user1
    const { apiKey } = await apiKeyService.create({
      userId: user1.id,
      name: "User1 Key",
      roles: ["user"],
    });

    // Try to revoke user1's key as user2
    await expect(
      apiKeyService.revoke(apiKey.id, user2.id),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("should create API key with description", async ({ expect }) => {
    const { sessionService, apiKeyService } = await setup();

    // Create a user
    const user = await sessionService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user", "admin"],
    });

    // Create API key with description
    const { apiKey, token } = await apiKeyService.create({
      userId: user.id,
      name: "My Key",
      description: "Used for CI/CD pipeline",
      roles: ["user", "admin"],
    });

    expect(apiKey.name).toBe("My Key");
    expect(apiKey.description).toBe("Used for CI/CD pipeline");
    expect(apiKey.roles).toEqual(["user", "admin"]);
    expect(token).toMatch(/^ak_/);

    // Validate works
    const userInfo = await apiKeyService.validate(token);
    expect(userInfo?.id).toBe(user.id);
    expect(userInfo?.roles).toEqual(["user", "admin"]);
  });

  it("should support API key with admin role", async ({ expect }) => {
    const { sessionService, apiKeyService } = await setup();

    // Create an admin user
    const adminUser = await sessionService.users().create({
      username: "admin",
      email: "admin@example.com",
      roles: ["admin"],
    });

    // Create an API key with admin role
    const { token } = await apiKeyService.create({
      userId: adminUser.id,
      name: "Admin API Key",
      roles: ["admin"],
    });

    // Validate API key returns admin role
    const userInfo = await apiKeyService.validate(token);
    expect(userInfo).not.toBeNull();
    expect(userInfo?.id).toBe(adminUser.id);
    expect(userInfo?.roles).toEqual(["admin"]);
  });

  it("should not revoke already revoked keys twice", async ({ expect }) => {
    const { sessionService, apiKeyService } = await setup();

    // Create a user
    const user = await sessionService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    // Create and revoke an API key
    const { apiKey, token } = await apiKeyService.create({
      userId: user.id,
      name: "My Key",
      roles: ["user"],
    });

    await apiKeyService.revoke(apiKey.id, user.id);

    // Verify key is revoked
    const result = await apiKeyService.validate(token);
    expect(result).toBeNull();

    // Admin revoke should not fail on already revoked key
    await apiKeyService.revokeByAdmin(apiKey.id);
  });

  it("should create API key with custom prefix", async ({ expect }) => {
    const { sessionService, apiKeyService } = await setup();

    // Create a user
    const user = await sessionService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    // Create an API key with custom prefix
    const { token } = await apiKeyService.create({
      userId: user.id,
      name: "Custom Key",
      roles: ["user"],
      prefix: "prod",
    });

    expect(token).toMatch(/^prod_/);

    // Should still validate
    const userInfo = await apiKeyService.validate(token);
    expect(userInfo).not.toBeNull();
  });
});
