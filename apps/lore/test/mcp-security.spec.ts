import { Alepha, z } from "alepha";
import { ApiKeyController } from "alepha/api/keys";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";

// Admin context for admin controller calls
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

// Schema for generating fake user data
const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
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
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(AlephaMcp);
  alepha.with(LoreApi);
  alepha.with(LoreMcp);

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
        name: "campaign_list",
        arguments: {},
      });

      // OAuth-protected endpoint: no auth → RFC 9728 401 challenge.
      expect(result.status).toBe(401);
    });

    it("should authenticate via Bearer header", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, user);

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "campaign_list", arguments: {} },
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
        { name: "campaign_list", arguments: {} },
        { token },
      );

      expect(result.status).toBe(200);
      expect(isErrorResponse(result.data)).toBe(false);
    });

    it("should reject request with invalid API key", async ({ expect }) => {
      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "campaign_list", arguments: {} },
        { authorization: "Bearer ak_invalid_token_12345678" },
      );

      expect(result.status).toBe(401);
    });

    it("should reject request with malformed Bearer header", async ({
      expect,
    }) => {
      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "campaign_list", arguments: {} },
        { authorization: "Bearer" }, // Missing token
      );

      expect(result.status).toBe(401);
    });

    it("should reject request with wrong auth scheme", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, user);

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "campaign_list", arguments: {} },
        { authorization: `Basic ${token}` }, // Wrong scheme
      );

      expect(result.status).toBe(401);
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
        { name: "campaign_list", arguments: {} },
        { authorization: `Bearer ${token}` },
      );
      expect(isErrorResponse(beforeRevoke.data)).toBe(false);

      // Revoke the key
      await ctx.apiKeyController.revokeMyApiKey.fetch(
        { params: { id } },
        { user },
      );

      // Key revoked → resolver fails → 401 challenge.
      const afterRevoke = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "campaign_list", arguments: {} },
        { authorization: `Bearer ${token}` },
      );
      expect(afterRevoke.status).toBe(401);
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
        { name: "campaign_list", arguments: {} },
        { authorization: `Bearer ${token}` },
      );
      expect(isErrorResponse(beforeExpiry.data)).toBe(false);

      // Travel past expiration
      ctx.dateTimeProvider.travel(2, "hours");

      // Key expired → resolver fails → 401 challenge.
      const afterExpiry = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "campaign_list", arguments: {} },
        { authorization: `Bearer ${token}` },
      );
      expect(afterExpiry.status).toBe(401);
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
        { name: "campaign_list", arguments: {} },
        { authorization: `Bearer ${token1}` },
      );
      expect(isErrorResponse(result1.data)).toBe(false);

      const result2 = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "campaign_list", arguments: {} },
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

      // First key revoked → resolver fails → 401 challenge.
      const result1 = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "campaign_list", arguments: {} },
        { authorization: `Bearer ${token1}` },
      );
      expect(result1.status).toBe(401);

      // Second key should still work
      const result2 = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "campaign_list", arguments: {} },
        { authorization: `Bearer ${token2}` },
      );
      expect(isErrorResponse(result2.data)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // User Isolation
  // ---------------------------------------------------------------------------

  describe("User Isolation", () => {
    it("should isolate campaigns between users", async ({ expect }) => {
      const user1 = await createTestUser(ctx);
      const user2 = await createTestUser(ctx);

      const { token: token1 } = await createApiKey(ctx, user1);
      const { token: token2 } = await createApiKey(ctx, user2);

      // User1 lists campaigns (should be empty, but distinct from user2)
      const result1 = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "campaign_list", arguments: {} },
        { authorization: `Bearer ${token1}` },
      );

      // User2 lists campaigns
      const result2 = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "campaign_list", arguments: {} },
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
        { name: "campaign_list", arguments: {} },
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

      // Should include lore tools
      const toolNames = result.data.result?.tools?.map((t) => t.name) ?? [];
      expect(toolNames).toContain("campaign_list");
      expect(toolNames).toContain("quest_list");
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
        { name: "campaign_list", arguments: {} },
        { authorization: "" },
      );

      // Empty auth header → unauthenticated → 401 challenge.
      expect(result.status).toBe(401);
    });

    it("should handle JWT token (not API key)", async ({ expect }) => {
      // JWT tokens have dots, API keys have underscores
      const jwtLikeToken =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature";

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "campaign_list", arguments: {} },
        { authorization: `Bearer ${jwtLikeToken}` },
      );

      // Not a valid JWT for this realm → unauthenticated → 401 challenge.
      expect(result.status).toBe(401);
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
          { name: "campaign_list", arguments: {} },
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

      // Key revoked → resolver fails → 401 challenge.
      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "campaign_list", arguments: {} },
        { authorization: `Bearer ${token}` },
      );
      expect(result.status).toBe(401);
    });

    it("should handle very long token values gracefully", async ({
      expect,
    }) => {
      const longToken = `ak_${"x".repeat(10000)}`;

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "campaign_list", arguments: {} },
        { authorization: `Bearer ${longToken}` },
      );

      // Should fail gracefully without crashing → 401 challenge.
      expect(result.status).toBe(401);
    });

    it("should handle special characters in token", async ({ expect }) => {
      const weirdToken = "ak_<script>alert(1)</script>";

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "campaign_list", arguments: {} },
        { authorization: `Bearer ${weirdToken}` },
      );

      // Should fail gracefully → 401 challenge.
      expect(result.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // Streamable HTTP transport — GET should be rejected (no legacy SSE GET stream)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // campaign_context — orientation tool (folio index + active quests)
  // ---------------------------------------------------------------------------

  describe("campaign_context", () => {
    /**
     * Parse the JSON-encoded payload returned in MCP tool content. Tools
     * stringify their result into `content[0].text`; tests want the
     * structured object back.
     */
    const parseToolPayload = <T>(data: McpToolResult): T => {
      const text = data.result?.content?.[0]?.text;
      if (!text) throw new Error("Tool returned no content");
      return JSON.parse(text) as T;
    };

    interface CampaignContextResult {
      id: number;
      title: string;
      public: boolean;
      zones: string[];
      activeQuests: Array<{ shortId: number; title: string }>;
      folios: {
        shown: number;
        capped: boolean;
        items: Array<{ shortId: number; title: string; tags: string[] }>;
      };
    }

    it("returns the calling user's folios and active quests, capped at 30", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, owner);
      const campaignCtrl = ctx.alepha.inject(CampaignController);
      const folioCtrl = ctx.alepha.inject(FolioController);

      // Bootstrap: one campaign, a few folios, sorted by updatedAt desc on read.
      const created = await campaignCtrl.createCampaign.fetch(
        { body: { title: "Lore Probe" } },
        { user: owner },
      );
      const campaignId = created.data.id;
      const folioTitles = ["Alpha", "Beta", "Gamma"];
      for (const title of folioTitles) {
        await folioCtrl.create.fetch(
          {
            body: {
              campaignId,
              title,
              content: `# ${title}`,
              tags: ["probe"],
            },
          },
          { user: owner },
        );
      }

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "campaign_context", arguments: { campaign: campaignId } },
        { token },
      );

      expect(result.status).toBe(200);
      expect(isErrorResponse(result.data)).toBe(false);

      const payload = parseToolPayload<CampaignContextResult>(result.data);
      expect(payload.id).toBe(campaignId);
      expect(payload.title).toBe("Lore Probe");
      expect(payload.folios.shown).toBe(folioTitles.length);
      expect(payload.folios.capped).toBe(false);
      const returnedTitles = payload.folios.items.map((f) => f.title).sort();
      expect(returnedTitles).toEqual(folioTitles.slice().sort());
      // Token budget guard — keeps us honest as future fields land.
      expect(JSON.stringify(payload).length).toBeLessThan(12_000);
    });

    it("rejects a non-member on a private campaign (404)", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const stranger = await createTestUser(ctx);
      const { token: strangerToken } = await createApiKey(ctx, stranger);
      const campaignCtrl = ctx.alepha.inject(CampaignController);

      const created = await campaignCtrl.createCampaign.fetch(
        { body: { title: "Private Probe" } },
        { user: owner },
      );

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        {
          name: "campaign_context",
          arguments: { campaign: created.data.id },
        },
        { token: strangerToken },
      );

      expect(result.status).toBe(200);
      expect(isErrorResponse(result.data)).toBe(true);
    });

    it("rejects a non-member from another user's campaign (campaign scoping is mine-only)", async ({
      expect,
    }) => {
      // `resolveCampaignId` reuses `getMyCampaigns`, which lists owned +
      // member-of campaigns. A stranger calling `campaign_context` with a
      // foreign campaign id gets a NotFoundError — the actual security
      // boundary the orientation tool enforces.
      const owner = await createTestUser(ctx);
      const stranger = await createTestUser(ctx);
      const { token: strangerToken } = await createApiKey(ctx, stranger);
      const campaignCtrl = ctx.alepha.inject(CampaignController);

      const created = await campaignCtrl.createCampaign.fetch(
        { body: { title: "Private Probe" } },
        { user: owner },
      );

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        {
          name: "campaign_context",
          arguments: { campaign: created.data.id },
        },
        { token: strangerToken },
      );

      expect(result.status).toBe(200);
      expect(isErrorResponse(result.data)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // folio_get — wiki-style backlinks
  // ---------------------------------------------------------------------------

  describe("folio_get links", () => {
    const parseToolPayload = <T>(data: McpToolResult): T => {
      const text = data.result?.content?.[0]?.text;
      if (!text) throw new Error("Tool returned no content");
      return JSON.parse(text) as T;
    };

    interface FolioGetResult {
      shortId: number;
      title: string;
      content: string;
      links?: {
        outbound: Array<{
          kind: "folio" | "quest" | "blob";
          shortId: number;
          title: string;
        }>;
        inbound: Array<{ kind: "folio"; shortId: number; title: string }>;
      };
    }

    const fetchFolio = async (
      campaignId: number,
      shortId: number,
      token: string,
    ): Promise<FolioGetResult> => {
      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        {
          name: "folio_get",
          arguments: { shortId, campaign: campaignId },
        },
        { token },
      );
      if (isErrorResponse(result.data)) {
        throw new Error(
          `folio_get failed: ${JSON.stringify(getErrorMessage(result.data))}`,
        );
      }
      return parseToolPayload<FolioGetResult>(result.data);
    };

    it("resolves [[Title]] and [[#shortId]] to outbound + inbound refs", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, owner);
      const campaignCtrl = ctx.alepha.inject(CampaignController);
      const folioCtrl = ctx.alepha.inject(FolioController);

      const campaign = await campaignCtrl.createCampaign.fetch(
        { body: { title: "Links Probe" } },
        { user: owner },
      );
      const campaignId = campaign.data.id;

      // shortId is allocated in creation order — Alpha=1, Beta=2.
      const alpha = await folioCtrl.create.fetch(
        { body: { campaignId, title: "Alpha", content: "" } },
        { user: owner },
      );
      const beta = await folioCtrl.create.fetch(
        {
          body: {
            campaignId,
            title: "Beta",
            content: `See [[Alpha]] for context, and [[#${alpha.data.shortId}]] again.`,
          },
        },
        { user: owner },
      );

      const betaResult = await fetchFolio(campaignId, beta.data.shortId, token);
      expect(betaResult.links?.outbound).toEqual([
        { kind: "folio", shortId: alpha.data.shortId, title: "Alpha" },
      ]);
      expect(betaResult.links?.inbound).toEqual([]);

      const alphaResult = await fetchFolio(
        campaignId,
        alpha.data.shortId,
        token,
      );
      expect(alphaResult.links?.inbound).toEqual([
        { kind: "folio", shortId: beta.data.shortId, title: "Beta" },
      ]);
      expect(alphaResult.links?.outbound).toEqual([]);
    });

    it("re-syncs links when a folio is updated (dropped reference disappears)", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, owner);
      const campaignCtrl = ctx.alepha.inject(CampaignController);
      const folioCtrl = ctx.alepha.inject(FolioController);

      const campaign = await campaignCtrl.createCampaign.fetch(
        { body: { title: "Re-sync Probe" } },
        { user: owner },
      );
      const campaignId = campaign.data.id;
      const alpha = await folioCtrl.create.fetch(
        { body: { campaignId, title: "Alpha", content: "" } },
        { user: owner },
      );
      const beta = await folioCtrl.create.fetch(
        {
          body: {
            campaignId,
            title: "Beta",
            content: "See [[Alpha]].",
          },
        },
        { user: owner },
      );

      // Sanity — inbound is set.
      expect(
        (await fetchFolio(campaignId, alpha.data.shortId, token)).links
          ?.inbound,
      ).toHaveLength(1);

      // Drop the reference.
      await folioCtrl.update.fetch(
        {
          params: { id: beta.data.id },
          body: { content: "No more references here." },
        },
        { user: owner },
      );

      expect(
        (await fetchFolio(campaignId, alpha.data.shortId, token)).links
          ?.inbound,
      ).toEqual([]);
    });

    it("drops self-links and unresolved references", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, owner);
      const campaignCtrl = ctx.alepha.inject(CampaignController);
      const folioCtrl = ctx.alepha.inject(FolioController);

      const campaign = await campaignCtrl.createCampaign.fetch(
        { body: { title: "Edge Probe" } },
        { user: owner },
      );
      const campaignId = campaign.data.id;
      const solo = await folioCtrl.create.fetch(
        {
          body: {
            campaignId,
            title: "Solo",
            // Self-link [[Solo]] and a dangling [[Missing]] reference.
            content: "[[Solo]] [[Missing Note]] hello",
          },
        },
        { user: owner },
      );

      const result = await fetchFolio(campaignId, solo.data.shortId, token);
      expect(result.links?.outbound).toEqual([]);
      expect(result.links?.inbound).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // sigil_* / blight_list — owner-gated sigil management + Blights inbox
  // ---------------------------------------------------------------------------

  describe("sigil tools", () => {
    const parseToolPayload = <T>(data: McpToolResult): T => {
      const text = data.result?.content?.[0]?.text;
      if (!text) throw new Error("Tool returned no content");
      return JSON.parse(text) as T;
    };

    interface SigilResource {
      id: string;
      label: string;
    }

    it("owner can create, list, and delete sigils — ingestKey never exposed", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, owner);
      const campaignCtrl = ctx.alepha.inject(CampaignController);

      const campaign = await campaignCtrl.createCampaign.fetch(
        { body: { title: "Sigil Probe" } },
        { user: owner },
      );
      const campaignId = campaign.data.id;

      // Create
      const createResult = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        {
          name: "sigil_create",
          arguments: {
            campaign: campaignId,
            label: "shop.example.com checkout",
          },
        },
        { token },
      );
      expect(isErrorResponse(createResult.data)).toBe(false);
      const created = parseToolPayload<SigilResource>(createResult.data);
      expect(created.label).toBe("shop.example.com checkout");
      // The secret must never leave the server.
      expect(createResult.data.result?.content?.[0]?.text).not.toContain(
        "ingestKey",
      );

      // List
      const listResult = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "sigil_list", arguments: { campaign: campaignId } },
        { token },
      );
      expect(isErrorResponse(listResult.data)).toBe(false);
      const { sigils } = parseToolPayload<{ sigils: SigilResource[] }>(
        listResult.data,
      );
      expect(sigils).toHaveLength(1);
      expect(sigils[0]?.id).toBe(created.id);
      expect(listResult.data.result?.content?.[0]?.text).not.toContain(
        "ingestKey",
      );

      // Delete (hard delete — the row is gone).
      const deleteResult = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        {
          name: "sigil_delete",
          arguments: { campaign: campaignId, id: created.id },
        },
        { token },
      );
      expect(isErrorResponse(deleteResult.data)).toBe(false);

      // The deleted sigil is genuinely gone — the list is empty.
      const afterDelete = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "sigil_list", arguments: { campaign: campaignId } },
        { token },
      );
      const after = parseToolPayload<{ sigils: SigilResource[] }>(
        afterDelete.data,
      );
      expect(after.sigils).toHaveLength(0);
    });

    it("blight_list works for the owner (empty inbox)", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, owner);
      const campaignCtrl = ctx.alepha.inject(CampaignController);

      const campaign = await campaignCtrl.createCampaign.fetch(
        { body: { title: "Blight Probe" } },
        { user: owner },
      );

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "blight_list", arguments: { campaign: campaign.data.id } },
        { token },
      );
      expect(isErrorResponse(result.data)).toBe(false);
      const payload = parseToolPayload<{
        blights: unknown[];
        openCount: number;
      }>(result.data);
      expect(payload.blights).toEqual([]);
      expect(payload.openCount).toBe(0);
    });

    it("rejects a non-owner from every sigil tool (user isolation)", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const stranger = await createTestUser(ctx);
      const { token: strangerToken } = await createApiKey(ctx, stranger);
      const campaignCtrl = ctx.alepha.inject(CampaignController);

      const campaign = await campaignCtrl.createCampaign.fetch(
        { body: { title: "Owned Probe" } },
        { user: owner },
      );
      const campaignId = campaign.data.id;

      // sigil_list
      const list = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "sigil_list", arguments: { campaign: campaignId } },
        { token: strangerToken },
      );
      expect(isErrorResponse(list.data)).toBe(true);

      // sigil_create
      const create = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        {
          name: "sigil_create",
          arguments: { campaign: campaignId, label: "evil" },
        },
        { token: strangerToken },
      );
      expect(isErrorResponse(create.data)).toBe(true);

      // sigil_delete
      const revoke = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        {
          name: "sigil_delete",
          arguments: { campaign: campaignId, id: crypto.randomUUID() },
        },
        { token: strangerToken },
      );
      expect(isErrorResponse(revoke.data)).toBe(true);

      // blight_list
      const blights = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "blight_list", arguments: { campaign: campaignId } },
        { token: strangerToken },
      );
      expect(isErrorResponse(blights.data)).toBe(true);
    });

    it("a genuine member who is not the owner is still rejected by every sigil tool", async ({
      expect,
    }) => {
      // Sigils are an owner-only management surface — even a real campaign
      // member (not owner) must be rejected. This exercises the owner-gate
      // itself, not the resolveCampaignId not-a-member guard.
      const owner = await createTestUser(ctx);
      const member = await createTestUser(ctx);
      const { token: memberToken } = await createApiKey(ctx, member);
      const campaignCtrl = ctx.alepha.inject(CampaignController);

      const campaign = await campaignCtrl.createCampaign.fetch(
        { body: { title: "Member Probe" } },
        { user: owner },
      );
      const campaignId = campaign.data.id;

      // Seed `member` as a genuine non-owner member on the campaign via a
      // direct repo insert — the standard path is through invitations, which
      // is more plumbing than this test needs (same pattern as
      // campaign-leave.spec.ts).
      const membersRepo = (campaignCtrl as any).members;
      await membersRepo.create({
        userId: member.id,
        campaignId,
        owner: false,
      });

      // Sanity: the campaign now resolves for the member (it shows up in
      // getMyCampaigns), so resolveCampaignId passes — any rejection below
      // comes from the controller's owner-gate, not the membership guard.
      const visible = await campaignCtrl.getMyCampaigns.fetch(
        { query: { size: 50, sort: "-updatedAt" } },
        { user: member },
      );
      expect(visible.data.some((c) => c.id === campaignId)).toBe(true);

      // sigil_list — owner-only.
      const list = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "sigil_list", arguments: { campaign: campaignId } },
        { token: memberToken },
      );
      expect(isErrorResponse(list.data)).toBe(true);

      // sigil_create — owner-only.
      const create = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        {
          name: "sigil_create",
          arguments: { campaign: campaignId, label: "member-attempt" },
        },
        { token: memberToken },
      );
      expect(isErrorResponse(create.data)).toBe(true);

      // sigil_delete — owner-only.
      const revoke = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        {
          name: "sigil_delete",
          arguments: { campaign: campaignId, id: crypto.randomUUID() },
        },
        { token: memberToken },
      );
      expect(isErrorResponse(revoke.data)).toBe(true);

      // blight_list — NOT owner-gated: the crash inbox is readable by any
      // campaign member (only sigil *management* above stays owner-only).
      const blights = await mcpRequest(
        ctx.baseUrl,
        "tools/call",
        { name: "blight_list", arguments: { campaign: campaignId } },
        { token: memberToken },
      );
      expect(isErrorResponse(blights.data)).toBe(false);
    });

    it("rejects sigil tools without authentication", async ({ expect }) => {
      const result = await mcpRequest(ctx.baseUrl, "tools/call", {
        name: "sigil_list",
        arguments: { campaign: 1 },
      });
      expect(isErrorResponse(result.data)).toBe(true);
    });

    it("exposes the four sigil tools in tools/list", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const { token } = await createApiKey(ctx, user);

      const result = await mcpRequest(
        ctx.baseUrl,
        "tools/list",
        {},
        { authorization: `Bearer ${token}` },
      );
      const toolNames = result.data.result?.tools?.map((t) => t.name) ?? [];
      expect(toolNames).toContain("sigil_list");
      expect(toolNames).toContain("sigil_create");
      expect(toolNames).toContain("sigil_delete");
      expect(toolNames).toContain("blight_list");
    });
  });

  // ---------------------------------------------------------------------------
  // Streamable HTTP transport — GET should be rejected (no legacy SSE GET stream)
  // ---------------------------------------------------------------------------

  describe("GET /mcp", () => {
    it("should reject with 405 Method Not Allowed (legacy SSE GET removed)", async ({
      expect,
    }) => {
      const response = await fetch(`${ctx.baseUrl}/mcp`, {
        method: "GET",
      });

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    });
  });
});
