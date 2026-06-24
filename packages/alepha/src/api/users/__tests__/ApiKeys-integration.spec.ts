import { randomUUID } from "node:crypto";
import { Alepha, z } from "alepha";
import { AdminApiKeyController, ApiKeyController } from "alepha/api/keys";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $secure, AlephaSecurity } from "alepha/security";
import { $action, AlephaServer } from "alepha/server";
import { describe, it } from "vitest";
import { AdminUserController } from "../controllers/AdminUserController.ts";
import { $realm, AlephaApiUsers } from "../index.ts";

// Admin context for admin controller calls
const adminUser = { id: randomUUID(), roles: ["admin"] };

// Schema for generating fake user data
const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error" },
  });

  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);

  // Create a realm with API keys enabled
  class TestApp {
    realm = $realm({
      features: { apiKeys: true },
    });

    // A protected action to test API key authentication (any authenticated user)
    getProfile = $action({
      path: "/profile",
      group: "profile",
      use: [$secure()],
      schema: {
        response: z.object({
          userId: z.string(),
          roles: z.array(z.string()),
        }),
      },
      handler: (request) => ({
        userId: request.user.id,
        roles: request.user.roles ?? [],
      }),
    });

    // Admin-only action (explicit permission — user role excludes "admin:*")
    adminStats = $action({
      path: "/admin/stats",
      method: "GET",
      group: "admin:stats",
      use: [$secure({ permissions: ["admin:stats"] })],
      schema: {
        response: z.object({
          message: z.string(),
          adminId: z.string(),
          roles: z.array(z.string()),
        }),
      },
      handler: (request) => ({
        message: "Admin stats retrieved",
        adminId: request.user.id,
        roles: request.user.roles ?? [],
      }),
    });
  }

  const app = alepha.inject(TestApp);
  await alepha.start();

  const adminUserController = alepha.inject(AdminUserController);
  const apiKeyController = alepha.inject(ApiKeyController);
  const adminApiKeyController = alepha.inject(AdminApiKeyController);
  const dateTimeProvider = alepha.inject(DateTimeProvider);
  const fakeProvider = alepha.inject(FakeProvider);

  return {
    alepha,
    app,
    adminUserController,
    apiKeyController,
    adminApiKeyController,
    dateTimeProvider,
    fakeProvider,
  };
};

describe("alepha/api/users - API Keys Integration (Controllers)", () => {
  // -------------------------------------------------------------------------
  // User API Key Management (CRUD via ApiKeyController)
  // -------------------------------------------------------------------------

  it("should create an API key via controller", async ({ expect }) => {
    const { adminUserController, apiKeyController, fakeProvider } =
      await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a user via admin controller
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    // Create API key via controller (authenticated as the user)
    const response = await apiKeyController.createApiKey.fetch(
      {
        body: {
          name: "My API Key",
          description: "Test key for CI/CD",
        },
      },
      { user: { id: user.id, roles: user.roles } },
    );

    expect(response.status).toBe(200);
    expect(response.data.name).toBe("My API Key");
    expect(response.data.token).toMatch(/^ak_/);
    expect(response.data.roles).toEqual(["user"]);
  });

  it("should list user's own API keys via controller", async ({ expect }) => {
    const { adminUserController, apiKeyController, fakeProvider } =
      await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a user
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    // Create multiple API keys
    await apiKeyController.createApiKey.fetch(
      { body: { name: "Key 1" } },
      { user: { id: user.id, roles: user.roles } },
    );
    await apiKeyController.createApiKey.fetch(
      { body: { name: "Key 2" } },
      { user: { id: user.id, roles: user.roles } },
    );

    // List keys via controller
    const response = await apiKeyController.listApiKeys.fetch(
      {},
      { user: { id: user.id, roles: user.roles } },
    );

    expect(response.status).toBe(200);
    expect(response.data).toHaveLength(2);
    expect(response.data.map((k) => k.name).sort()).toEqual(["Key 1", "Key 2"]);
  });

  it("should revoke own API key via controller", async ({ expect }) => {
    const { adminUserController, apiKeyController, app, fakeProvider } =
      await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a user
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    // Create an API key
    const createResponse = await apiKeyController.createApiKey.fetch(
      { body: { name: "My Key" } },
      { user: { id: user.id, roles: user.roles } },
    );
    const { id, token } = createResponse.data;

    // Verify key works (access protected endpoint via query param)
    const beforeRevoke = await app.getProfile.fetch({
      query: { api_key: token },
    });
    expect(beforeRevoke.status).toBe(200);
    expect(beforeRevoke.data.userId).toBe(user.id);

    // Revoke the key
    const revokeResponse = await apiKeyController.revokeMyApiKey.fetch(
      { params: { id } },
      { user: { id: user.id, roles: user.roles } },
    );

    expect(revokeResponse.status).toBe(200);
    expect(revokeResponse.data.ok).toBe(true);

    // Verify key no longer works
    await expect(
      app.getProfile.fetch({ query: { api_key: token } }),
    ).rejects.toThrow();
  });

  it("should not allow revoking another user's API key", async ({ expect }) => {
    const { adminUserController, apiKeyController, fakeProvider } =
      await setup();

    // Create two users
    const user1Response = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeProvider.generate(userDataSchema),
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user1 = user1Response.data;

    const user2Response = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeProvider.generate(userDataSchema),
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user2 = user2Response.data;

    // User1 creates an API key
    const createResponse = await apiKeyController.createApiKey.fetch(
      { body: { name: "User1 Key" } },
      { user: { id: user1.id, roles: user1.roles } },
    );
    const { id } = createResponse.data;

    // User2 tries to revoke User1's key - should fail with 403
    await expect(
      apiKeyController.revokeMyApiKey.fetch(
        { params: { id } },
        { user: { id: user2.id, roles: user2.roles } },
      ),
    ).rejects.toThrow("Not your API key");
  });

  it("should create API key with expiration", async ({ expect }) => {
    const {
      adminUserController,
      apiKeyController,
      app,
      dateTimeProvider,
      fakeProvider,
    } = await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a user
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    // Create API key with 1 hour expiration
    const expiresAt = dateTimeProvider.now().add(1, "hour").toISOString();
    const createResponse = await apiKeyController.createApiKey.fetch(
      { body: { name: "Expiring Key", expiresAt } },
      { user: { id: user.id, roles: user.roles } },
    );

    expect(createResponse.status).toBe(200);
    expect(createResponse.data.expiresAt).toBe(expiresAt);

    const { token } = createResponse.data;

    // Verify key works before expiry
    const beforeExpiry = await app.getProfile.fetch({
      query: { api_key: token },
    });
    expect(beforeExpiry.status).toBe(200);

    // Travel past expiration
    dateTimeProvider.travel(2, "hours");

    // Verify key no longer works
    await expect(
      app.getProfile.fetch({ query: { api_key: token } }),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Admin API Key Management (via AdminApiKeyController)
  // -------------------------------------------------------------------------

  it("should list all API keys via admin controller", async ({ expect }) => {
    const {
      adminUserController,
      apiKeyController,
      adminApiKeyController,
      fakeProvider,
    } = await setup();

    // Create two users with API keys
    const user1Response = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeProvider.generate(userDataSchema),
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user1 = user1Response.data;

    const user2Response = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeProvider.generate(userDataSchema),
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user2 = user2Response.data;

    // Each user creates an API key
    await apiKeyController.createApiKey.fetch(
      { body: { name: "User1 Key" } },
      { user: { id: user1.id, roles: user1.roles } },
    );
    await apiKeyController.createApiKey.fetch(
      { body: { name: "User2 Key" } },
      { user: { id: user2.id, roles: user2.roles } },
    );

    // Admin lists all API keys
    const response = await adminApiKeyController.findApiKeys.fetch(
      {},
      { user: adminUser },
    );

    expect(response.status).toBe(200);
    expect(response.data.content).toHaveLength(2);
  });

  it("should filter API keys by userId via admin controller", async ({
    expect,
  }) => {
    const {
      adminUserController,
      apiKeyController,
      adminApiKeyController,
      fakeProvider,
    } = await setup();

    // Create two users
    const user1Response = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeProvider.generate(userDataSchema),
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user1 = user1Response.data;

    const user2Response = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeProvider.generate(userDataSchema),
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user2 = user2Response.data;

    // Create keys for both users
    await apiKeyController.createApiKey.fetch(
      { body: { name: "User1 Key" } },
      { user: { id: user1.id, roles: user1.roles } },
    );
    await apiKeyController.createApiKey.fetch(
      { body: { name: "User2 Key" } },
      { user: { id: user2.id, roles: user2.roles } },
    );

    // Admin filters by user1
    const response = await adminApiKeyController.findApiKeys.fetch(
      { query: { userId: user1.id } },
      { user: adminUser },
    );

    expect(response.status).toBe(200);
    expect(response.data.content).toHaveLength(1);
    expect(response.data.content[0].name).toBe("User1 Key");
  });

  it("should get API key by ID via admin controller", async ({ expect }) => {
    const {
      adminUserController,
      apiKeyController,
      adminApiKeyController,
      fakeProvider,
    } = await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a user with an API key
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    const createResponse = await apiKeyController.createApiKey.fetch(
      { body: { name: "My Key", description: "Test description" } },
      { user: { id: user.id, roles: user.roles } },
    );
    const { id } = createResponse.data;

    // Admin gets the key by ID
    const response = await adminApiKeyController.getApiKey.fetch(
      { params: { id } },
      { user: adminUser },
    );

    expect(response.status).toBe(200);
    expect(response.data.id).toBe(id);
    expect(response.data.name).toBe("My Key");
    expect(response.data.description).toBe("Test description");
    expect(response.data.userId).toBe(user.id);
  });

  it("should revoke any API key via admin controller", async ({ expect }) => {
    const {
      adminUserController,
      apiKeyController,
      adminApiKeyController,
      app,
      fakeProvider,
    } = await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a user with an API key
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    const createResponse = await apiKeyController.createApiKey.fetch(
      { body: { name: "My Key" } },
      { user: { id: user.id, roles: user.roles } },
    );
    const { id, token } = createResponse.data;

    // Verify key works
    const beforeRevoke = await app.getProfile.fetch({
      query: { api_key: token },
    });
    expect(beforeRevoke.status).toBe(200);

    // Admin revokes the key
    const response = await adminApiKeyController.revokeApiKey.fetch(
      { params: { id } },
      { user: adminUser },
    );

    expect(response.status).toBe(200);
    expect(response.data.ok).toBe(true);

    // Verify key no longer works
    await expect(
      app.getProfile.fetch({ query: { api_key: token } }),
    ).rejects.toThrow();
  });

  it("should include revoked keys when requested via admin controller", async ({
    expect,
  }) => {
    const {
      adminUserController,
      apiKeyController,
      adminApiKeyController,
      fakeProvider,
    } = await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a user
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    // Create and revoke a key
    const createResponse = await apiKeyController.createApiKey.fetch(
      { body: { name: "Revoked Key" } },
      { user: { id: user.id, roles: user.roles } },
    );
    await apiKeyController.revokeMyApiKey.fetch(
      { params: { id: createResponse.data.id } },
      { user: { id: user.id, roles: user.roles } },
    );

    // Create an active key
    await apiKeyController.createApiKey.fetch(
      { body: { name: "Active Key" } },
      { user: { id: user.id, roles: user.roles } },
    );

    // List without revoked (default)
    const activeOnly = await adminApiKeyController.findApiKeys.fetch(
      {},
      { user: adminUser },
    );
    expect(activeOnly.data.content).toHaveLength(1);
    expect(activeOnly.data.content[0].name).toBe("Active Key");

    // List with revoked
    const withRevoked = await adminApiKeyController.findApiKeys.fetch(
      { query: { includeRevoked: true } },
      { user: adminUser },
    );
    expect(withRevoked.data.content).toHaveLength(2);
  });

  it("should handle pagination via admin controller", async ({ expect }) => {
    const {
      adminUserController,
      apiKeyController,
      adminApiKeyController,
      fakeProvider,
    } = await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a user
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    // Create 5 API keys
    for (let i = 1; i <= 5; i++) {
      await apiKeyController.createApiKey.fetch(
        { body: { name: `Key ${i}` } },
        { user: { id: user.id, roles: user.roles } },
      );
    }

    // Get first page
    const page1 = await adminApiKeyController.findApiKeys.fetch(
      { query: { size: 2, page: 0 } },
      { user: adminUser },
    );
    expect(page1.data.content).toHaveLength(2);
    expect(page1.data.page.totalElements).toBe(5);
    expect(page1.data.page.totalPages).toBe(3);

    // Get second page
    const page2 = await adminApiKeyController.findApiKeys.fetch(
      { query: { size: 2, page: 1 } },
      { user: adminUser },
    );
    expect(page2.data.content).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // API Key Authentication (query param and Bearer header)
  // -------------------------------------------------------------------------

  it("should authenticate via api_key query parameter", async ({ expect }) => {
    const { adminUserController, apiKeyController, app, fakeProvider } =
      await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a user with an API key
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    const createResponse = await apiKeyController.createApiKey.fetch(
      { body: { name: "My Key" } },
      { user: { id: user.id, roles: user.roles } },
    );
    const { token } = createResponse.data;

    // Access protected endpoint via query param
    const response = await app.getProfile.fetch({
      query: { api_key: token },
    });

    expect(response.status).toBe(200);
    expect(response.data.userId).toBe(user.id);
    expect(response.data.roles).toEqual(["user"]);
  });

  it("should authenticate via Bearer header", async ({ expect }) => {
    const { adminUserController, apiKeyController, app, fakeProvider } =
      await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a user with an API key
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    const createResponse = await apiKeyController.createApiKey.fetch(
      { body: { name: "My Key" } },
      { user: { id: user.id, roles: user.roles } },
    );
    const { token } = createResponse.data;

    // Access protected endpoint via Bearer header
    const response = await app.getProfile.fetch({
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(response.data.userId).toBe(user.id);
    expect(response.data.roles).toEqual(["user"]);
  });

  it("should reject request with invalid API key", async ({ expect }) => {
    const { app } = await setup();

    // Try to access with invalid key
    await expect(
      app.getProfile.fetch({ query: { api_key: "ak_invalid_token_12345" } }),
    ).rejects.toThrow();
  });

  it("should reject request with revoked API key", async ({ expect }) => {
    const { adminUserController, apiKeyController, app, fakeProvider } =
      await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a user with an API key
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    const createResponse = await apiKeyController.createApiKey.fetch(
      { body: { name: "My Key" } },
      { user: { id: user.id, roles: user.roles } },
    );
    const { id, token } = createResponse.data;

    // Revoke the key
    await apiKeyController.revokeMyApiKey.fetch(
      { params: { id } },
      { user: { id: user.id, roles: user.roles } },
    );

    // Try to access with revoked key
    await expect(
      app.getProfile.fetch({ query: { api_key: token } }),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Role-based Access with API Keys
  // -------------------------------------------------------------------------

  it("should allow admin API key to access admin-only endpoint", async ({
    expect,
  }) => {
    const { adminUserController, apiKeyController, app, fakeProvider } =
      await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create an admin user
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["admin"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    // Create API key with admin role
    const createResponse = await apiKeyController.createApiKey.fetch(
      { body: { name: "Admin Key" } },
      { user: { id: user.id, roles: user.roles } },
    );
    const { token } = createResponse.data;

    // Access admin endpoint
    const response = await app.adminStats.fetch({
      query: { api_key: token },
    });

    expect(response.status).toBe(200);
    expect(response.data.message).toBe("Admin stats retrieved");
    expect(response.data.adminId).toBe(user.id);
    expect(response.data.roles).toContain("admin");
  });

  it("should reject user API key from admin-only endpoint", async ({
    expect,
  }) => {
    const { adminUserController, apiKeyController, app, fakeProvider } =
      await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a regular user
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    // Create API key with user role
    const createResponse = await apiKeyController.createApiKey.fetch(
      { body: { name: "User Key" } },
      { user: { id: user.id, roles: user.roles } },
    );
    const { token } = createResponse.data;

    // Try to access admin endpoint - should fail
    await expect(
      app.adminStats.fetch({ query: { api_key: token } }),
    ).rejects.toThrow();
  });

  it("should allow user API key to access user endpoint", async ({
    expect,
  }) => {
    const { adminUserController, apiKeyController, app, fakeProvider } =
      await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a regular user
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    // Create API key
    const createResponse = await apiKeyController.createApiKey.fetch(
      { body: { name: "User Key" } },
      { user: { id: user.id, roles: user.roles } },
    );
    const { token } = createResponse.data;

    // Access user endpoint via Bearer header
    const response = await app.getProfile.fetch({
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(response.data.userId).toBe(user.id);
  });

  it("should snapshot roles at API key creation time", async ({ expect }) => {
    const { adminUserController, apiKeyController, app, fakeProvider } =
      await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a user with user role
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    // Create API key (snapshots current roles: ["user"])
    const createResponse = await apiKeyController.createApiKey.fetch(
      { body: { name: "My Key" } },
      { user: { id: user.id, roles: user.roles } },
    );
    const { token } = createResponse.data;

    // Update user to have admin role
    await adminUserController.updateUser.fetch(
      {
        params: { id: user.id },
        body: { roles: ["user", "admin"] },
      },
      { user: adminUser },
    );

    // API key should still only have user role (snapshot)
    // So accessing admin endpoint should fail
    await expect(
      app.adminStats.fetch({ query: { api_key: token } }),
    ).rejects.toThrow();

    // But user endpoint should still work
    const response = await app.getProfile.fetch({
      query: { api_key: token },
    });
    expect(response.status).toBe(200);
    expect(response.data.roles).toEqual(["user"]); // Original roles
  });

  it("should create API key with multiple roles", async ({ expect }) => {
    const { adminUserController, apiKeyController, app, fakeProvider } =
      await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a user with multiple roles
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user", "admin"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    // Create API key
    const createResponse = await apiKeyController.createApiKey.fetch(
      { body: { name: "Power Key" } },
      { user: { id: user.id, roles: user.roles } },
    );

    expect(createResponse.data.roles).toContain("user");
    expect(createResponse.data.roles).toContain("admin");

    const { token } = createResponse.data;

    // Should access both user and admin endpoints
    const profileResponse = await app.getProfile.fetch({
      query: { api_key: token },
    });
    expect(profileResponse.status).toBe(200);

    const adminResponse = await app.adminStats.fetch({
      query: { api_key: token },
    });
    expect(adminResponse.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Edge Cases and Error Handling
  // -------------------------------------------------------------------------

  it("should return 404 when revoking non-existent API key", async ({
    expect,
  }) => {
    const { adminUserController, apiKeyController, fakeProvider } =
      await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a user
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    // Try to revoke non-existent key
    await expect(
      apiKeyController.revokeMyApiKey.fetch(
        { params: { id: "00000000-0000-0000-0000-000000000000" } },
        { user: { id: user.id, roles: user.roles } },
      ),
    ).rejects.toThrow("was not found");
  });

  it("should return 404 when getting non-existent API key via admin", async ({
    expect,
  }) => {
    const { adminApiKeyController } = await setup();

    // Try to get non-existent key
    await expect(
      adminApiKeyController.getApiKey.fetch(
        { params: { id: "00000000-0000-0000-0000-000000000000" } },
        { user: adminUser },
      ),
    ).rejects.toThrow("was not found");
  });

  it("should list empty when user has no API keys", async ({ expect }) => {
    const { adminUserController, apiKeyController, fakeProvider } =
      await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a user without any API keys
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    // List should return empty array
    const response = await apiKeyController.listApiKeys.fetch(
      {},
      { user: { id: user.id, roles: user.roles } },
    );

    expect(response.status).toBe(200);
    expect(response.data).toEqual([]);
  });

  it("should not return revoked keys in user's list", async ({ expect }) => {
    const { adminUserController, apiKeyController, fakeProvider } =
      await setup();
    const fakeUser = fakeProvider.generate(userDataSchema);

    // Create a user
    const userResponse = await adminUserController.createUser.fetch(
      {
        body: {
          ...fakeUser,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = userResponse.data;

    // Create and revoke a key
    const createResponse = await apiKeyController.createApiKey.fetch(
      { body: { name: "Revoked Key" } },
      { user: { id: user.id, roles: user.roles } },
    );
    await apiKeyController.revokeMyApiKey.fetch(
      { params: { id: createResponse.data.id } },
      { user: { id: user.id, roles: user.roles } },
    );

    // Create an active key
    await apiKeyController.createApiKey.fetch(
      { body: { name: "Active Key" } },
      { user: { id: user.id, roles: user.roles } },
    );

    // List should only show active key
    const response = await apiKeyController.listApiKeys.fetch(
      {},
      { user: { id: user.id, roles: user.roles } },
    );

    expect(response.data).toHaveLength(1);
    expect(response.data[0].name).toBe("Active Key");
  });
});
