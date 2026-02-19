import { Alepha, t } from "alepha";
import { ApiKeyController } from "alepha/api/keys";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { RoadmapApi } from "../src/api/index.ts";
import { RoadmapMcp } from "../src/mcp/index.ts";

// Admin context for admin controller calls
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

// Schema for generating fake user data
const userDataSchema = t.object({
  username: t.string(),
  email: t.email(),
});

interface TestContext {
  alepha: Alepha;
  baseUrl: string;
  adminUserController: AdminUserController;
  apiKeyController: ApiKeyController;
  dateTimeProvider: DateTimeProvider;
  fakeProvider: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0, // Random port
    },
  });

  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(AlephaMcp);
  alepha.with(RoadmapApi);
  alepha.with(RoadmapMcp);

  await alepha.start();

  const server = alepha.inject(NodeHttpServerProvider);
  const baseUrl = server.hostname;

  return {
    alepha,
    baseUrl,
    adminUserController: alepha.inject(AdminUserController),
    apiKeyController: alepha.inject(ApiKeyController),
    dateTimeProvider: alepha.inject(DateTimeProvider),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

/**
 * MCP tool call result structure.
 */
interface McpToolResult {
  jsonrpc: string;
  id: number;
  result?: {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    tools?: Array<{ name: string; description: string }>;
  };
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Helper to make MCP JSON-RPC requests.
 */
async function mcpRequest(
  baseUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  options: { authorization?: string; token?: string } = {},
): Promise<{ status: number; data: McpToolResult }> {
  const url = options.token
    ? `${baseUrl}/mcp?api_key=${options.token}`
    : `${baseUrl}/mcp`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.authorization) {
    headers.Authorization = options.authorization;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  const data = (await response.json()) as McpToolResult;
  return { status: response.status, data };
}

/**
 * Check if MCP response indicates an error (tool error or JSON-RPC error).
 */
function isErrorResponse(data: McpToolResult): boolean {
  return data.error !== undefined || data.result?.isError === true;
}

/**
 * Extract error message from MCP response.
 * - JSON-RPC errors: data.error.message
 * - Tool errors: data.result.content[0].text
 */
function getErrorMessage(data: McpToolResult): string | undefined {
  if (data.error) {
    return data.error.message;
  }
  if (data.result?.isError && data.result.content?.[0]?.text) {
    return data.result.content[0].text;
  }
  return undefined;
}

/**
 * Helper to create a user and return their info.
 */
async function createTestUser(
  ctx: TestContext,
  roles: string[] = ["user"],
): Promise<{ id: string; roles: string[] }> {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    {
      body: {
        ...fakeUser,
        roles,
      },
    },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
}

/**
 * Helper to create an API key for a user.
 */
async function createApiKey(
  ctx: TestContext,
  user: { id: string; roles: string[] },
  options: { name?: string; expiresAt?: string } = {},
): Promise<{ id: string; token: string }> {
  const response = await ctx.apiKeyController.createApiKey.fetch(
    {
      body: {
        name: options.name ?? "Test Key",
        expiresAt: options.expiresAt,
      },
    },
    { user },
  );
  return { id: response.data.id, token: response.data.token };
}

describe("MCP Security Integration", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  // ---------------------------------------------------------------------------
  // Basic Authentication
  // ---------------------------------------------------------------------------

  describe("Basic Authentication", () => {
    it("should reject request without authentication", async ({ expect }) => {
      const result = await mcpRequest(ctx.baseUrl, "tools/call", {
        name: "project_list",
        arguments: {},
      });

      expect(result.status).toBe(200);
      expect(isErrorResponse(result.data)).toBe(true);
    });

    it("should authenticate via Bearer header", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, user);

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Bearer ${token}` },
      );

      expect(result.status).toBe(200);
      expect(isErrorResponse(result.data)).toBe(false);
    });

    it("should authenticate via token query parameter", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, user);

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { token },
      );

      expect(result.status).toBe(200);
      expect(isErrorResponse(result.data)).toBe(false);
    });

    it("should reject request with invalid API key", async ({ expect }) => {
      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: "Bearer ak_invalid_token_12345678" },
      );

      expect(result.status).toBe(200);
      expect(isErrorResponse(result.data)).toBe(true);
    });

    it("should reject request with malformed Bearer header", async ({
      expect,
    }) => {
      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: "Bearer" }, // Missing token
      );

      expect(result.status).toBe(200);
      expect(isErrorResponse(result.data)).toBe(true);
    });

    it("should reject request with wrong auth scheme", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, user);

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Basic ${token}` }, // Wrong scheme
      );

      expect(result.status).toBe(200);
      expect(isErrorResponse(result.data)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // API Key Lifecycle
  // ---------------------------------------------------------------------------

  describe("API Key Lifecycle", () => {
    it("should reject request with revoked API key", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const { id, token } = await createApiKey(ctx, user);

      // Verify key works before revocation
      const beforeRevoke = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Bearer ${token}` },
      );
      expect(isErrorResponse(beforeRevoke.data)).toBe(false);

      // Revoke the key
      await ctx.apiKeyController.revokeMyApiKey.fetch(
        { params: { id } },
        { user },
      );

      // Key should no longer work - returns MCP error
      const afterRevoke = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Bearer ${token}` },
      );
      expect(afterRevoke.status).toBe(200);
      expect(isErrorResponse(afterRevoke.data)).toBe(true);
    });

    it("should reject request with expired API key", async ({ expect }) => {
      const user = await createTestUser(ctx);

      // Create key that expires in 1 hour
      const expiresAt = ctx.dateTimeProvider.now().add(1, "hour").toISOString();
      const { token } = await createApiKey(ctx, user, { expiresAt });

      // Key should work before expiration
      const beforeExpiry = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Bearer ${token}` },
      );
      expect(isErrorResponse(beforeExpiry.data)).toBe(false);

      // Travel past expiration
      ctx.dateTimeProvider.travel(2, "hours");

      // Key should no longer work - returns MCP error
      const afterExpiry = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Bearer ${token}` },
      );
      expect(afterExpiry.status).toBe(200);
      expect(isErrorResponse(afterExpiry.data)).toBe(true);
    });

    it("should allow multiple API keys per user", async ({ expect }) => {
      const user = await createTestUser(ctx);

      const { token: token1 } = await createApiKey(ctx, user, {
        name: "Key 1",
      });
      const { token: token2 } = await createApiKey(ctx, user, {
        name: "Key 2",
      });

      // Both keys should work
      const result1 = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Bearer ${token1}` },
      );
      expect(isErrorResponse(result1.data)).toBe(false);

      const result2 = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Bearer ${token2}` },
      );
      expect(isErrorResponse(result2.data)).toBe(false);
    });

    it("should not affect other keys when one is revoked", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);

      const { id: id1, token: token1 } = await createApiKey(ctx, user, {
        name: "Key 1",
      });
      const { token: token2 } = await createApiKey(ctx, user, {
        name: "Key 2",
      });

      // Revoke first key
      await ctx.apiKeyController.revokeMyApiKey.fetch(
        { params: { id: id1 } },
        { user },
      );

      // First key should not work - returns MCP error
      const result1 = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Bearer ${token1}` },
      );
      expect(result1.status).toBe(200);
      expect(isErrorResponse(result1.data)).toBe(true);

      // Second key should still work
      const result2 = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Bearer ${token2}` },
      );
      expect(isErrorResponse(result2.data)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // User Isolation
  // ---------------------------------------------------------------------------

  describe("User Isolation", () => {
    it("should isolate projects between users", async ({ expect }) => {
      const user1 = await createTestUser(ctx);
      const user2 = await createTestUser(ctx);

      const { token: token1 } = await createApiKey(ctx, user1);
      const { token: token2 } = await createApiKey(ctx, user2);

      // User1 lists projects (should be empty, but distinct from user2)
      const result1 = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Bearer ${token1}` },
      );

      // User2 lists projects
      const result2 = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Bearer ${token2}` },
      );

      // Both should succeed (even if empty)
      expect(isErrorResponse(result1.data)).toBe(false);
      expect(isErrorResponse(result2.data)).toBe(false);
    });

    it("should not allow one user to revoke another user's API key", async ({
      expect,
    }) => {
      const user1 = await createTestUser(ctx);
      const user2 = await createTestUser(ctx);

      // User1 creates an API key
      const { id, token } = await createApiKey(ctx, user1);

      // User2 cannot revoke user1's key
      await expect(
        ctx.apiKeyController.revokeMyApiKey.fetch(
          { params: { id } },
          { user: user2 },
        ),
      ).rejects.toThrow("Not your API key");

      // But user1's key still works
      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Bearer ${token}` },
      );
      expect(isErrorResponse(result.data)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // MCP Protocol
  // ---------------------------------------------------------------------------

  describe("MCP Protocol", () => {
    it("should list available tools", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, user);

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/list",
        {},
        { authorization: `Bearer ${token}` },
      );

      expect(result.status).toBe(200);
      expect(result.data.result).toBeDefined();
      expect(result.data.result?.tools).toBeInstanceOf(Array);

      // Should include roadmap tools
      const toolNames = result.data.result?.tools?.map((t) => t.name) ?? [];
      expect(toolNames).toContain("project_list");
      expect(toolNames).toContain("task_list");
    });

    it("should return error for unknown tool", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, user);

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "unknown_tool", arguments: {} },
        { authorization: `Bearer ${token}` },
      );

      expect(result.status).toBe(200);
      // Unknown tool should return JSON-RPC error
      expect(result.data.error).toBeDefined();
      expect(result.data.error?.message).toContain("unknown_tool");
    });

    it("should handle invalid JSON-RPC request", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, user);

      const response = await fetch(`${ctx.baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: "not valid json",
      });

      expect(response.status).toBe(400);
    });

    it("should handle missing method in JSON-RPC request", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, user);

      const response = await fetch(`${ctx.baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          // Missing method
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge Cases
  // ---------------------------------------------------------------------------

  describe("Edge Cases", () => {
    it("should handle empty authorization header", async ({ expect }) => {
      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: "" },
      );

      // Empty auth header returns MCP error (controller rejects)
      expect(result.status).toBe(200);
      expect(isErrorResponse(result.data)).toBe(true);
    });

    it("should handle JWT token (not API key)", async ({ expect }) => {
      // JWT tokens have dots, API keys have underscores
      const jwtLikeToken =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature";

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Bearer ${jwtLikeToken}` },
      );

      // Should fail because it's not a valid JWT for this realm - returns MCP error
      expect(result.status).toBe(200);
      expect(isErrorResponse(result.data)).toBe(true);
    });

    it("should handle concurrent requests with same API key", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, user);

      // Make 5 concurrent requests
      const requests = Array.from({ length: 5 }, () =>
        mcpRequest(
          ctx.baseUrl,
          "tools/call",
          { name: "project_list", arguments: {} },
          { authorization: `Bearer ${token}` },
        ),
      );

      const results = await Promise.all(requests);

      // All should succeed
      for (const result of results) {
        expect(result.status).toBe(200);
        expect(isErrorResponse(result.data)).toBe(false);
      }
    });

    it("should handle rapid key creation and revocation", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);

      // Create and immediately revoke a key
      const { id, token } = await createApiKey(ctx, user);
      await ctx.apiKeyController.revokeMyApiKey.fetch(
        { params: { id } },
        { user },
      );

      // Key should not work - returns MCP error
      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Bearer ${token}` },
      );
      expect(result.status).toBe(200);
      expect(isErrorResponse(result.data)).toBe(true);
    });

    it("should handle very long token values gracefully", async ({
      expect,
    }) => {
      const longToken = `ak_${"x".repeat(10000)}`;

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Bearer ${longToken}` },
      );

      // Should fail gracefully without crashing - returns MCP error
      expect(result.status).toBe(200);
      expect(isErrorResponse(result.data)).toBe(true);
    });

    it("should handle special characters in token", async ({ expect }) => {
      const weirdToken = "ak_<script>alert(1)</script>";

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "project_list", arguments: {} },
        { authorization: `Bearer ${weirdToken}` },
      );

      // Should fail gracefully - returns MCP error
      expect(result.status).toBe(200);
      expect(isErrorResponse(result.data)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // SSE Endpoint
  // ---------------------------------------------------------------------------

  describe("SSE Endpoint", () => {
    it("should return SSE stream on GET /mcp", async ({ expect }) => {
      const response = await fetch(`${ctx.baseUrl}/mcp`, {
        method: "GET",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
    });
  });
});
