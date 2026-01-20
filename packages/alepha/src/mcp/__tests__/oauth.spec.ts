import { Alepha, t } from "alepha";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { describe, it } from "vitest";
import { McpForbiddenError, McpUnauthorizedError } from "../errors/McpError.ts";
import {
  $mcpAuth,
  $tool,
  AlephaMcp,
  MCP_PROTOCOL_VERSION,
  type McpAuthContext,
  McpServerProvider,
  OAuthClientService,
} from "../index.ts";

// ---------------------------------------------------------------------------------------------------------------------

const SECRET = "test-secret-key-for-mcp-oauth-32bytes";

const setup = async () => {
  process.env.DATABASE_URL = "pglite://:memory:";

  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error" },
  });

  class MyMcpServer {
    auth = $mcpAuth({
      name: "mcp",
      secret: SECRET,
    });

    publicTool = $tool({
      description: "A public tool that requires no auth",
      schema: {
        params: t.object({ message: t.text() }),
        result: t.text(),
      },
      handler: async ({ params }) => `Echo: ${params.message}`,
    });

    protectedTool = $tool({
      description: "A protected tool that requires auth",
      schema: {
        params: t.object({ message: t.text() }),
        result: t.text(),
      },
      handler: async ({ params, context }) => {
        const auth = context?.data as McpAuthContext | undefined;
        if (!auth?.client && !auth?.user) {
          throw new McpUnauthorizedError("Authentication required");
        }
        return `Protected: ${params.message} (client: ${auth.client?.name ?? "none"})`;
      },
    });

    scopedTool = $tool({
      description: "A tool that requires specific scope",
      schema: {
        params: t.object({ data: t.text() }),
        result: t.text(),
      },
      handler: async ({ params, context }) => {
        const auth = context?.data as McpAuthContext | undefined;
        if (!auth?.client && !auth?.user) {
          throw new McpUnauthorizedError("Authentication required");
        }

        // Check for specific scope using the auth primitive
        const hasScope = auth.scopes?.includes("mcp:admin") ?? false;
        if (!hasScope) {
          throw new McpForbiddenError("Scope 'mcp:admin' required");
        }

        return `Admin operation: ${params.data}`;
      },
    });
  }

  alepha.with(AlephaSecurity);
  alepha.with(AlephaMcp);
  alepha.with(MyMcpServer);

  // Inject before starting
  const mcpServer = alepha.inject(MyMcpServer);
  const provider = alepha.inject(McpServerProvider);
  const oauthService = alepha.inject(OAuthClientService);
  const crypto = alepha.inject(CryptoProvider);

  await alepha.start();

  return {
    alepha,
    mcpServer,
    provider,
    oauthService,
    crypto,
    auth: mcpServer.auth,
  };
};

// ---------------------------------------------------------------------------------------------------------------------

describe("MCP OAuth2 Authentication", () => {
  describe("OAuth Client Management", () => {
    it("should create a new OAuth client", async ({ expect }) => {
      const { oauthService } = await setup();

      const { client, clientSecret } = await oauthService.createClient({
        name: "Test Client",
        description: "A test OAuth client",
        scopes: ["mcp:tools:*"],
      });

      expect(client.id).toBeDefined();
      expect(client.clientId).toMatch(/^mcp_/);
      expect(client.name).toBe("Test Client");
      expect(client.description).toBe("A test OAuth client");
      expect(client.scopes).toEqual(["mcp:tools:*"]);
      expect(client.enabled).toBe(true);
      expect(clientSecret).toBeDefined();
      expect(clientSecret.length).toBeGreaterThan(20);
    });

    it("should find client by clientId", async ({ expect }) => {
      const { oauthService } = await setup();

      const { client } = await oauthService.createClient({
        name: "Find Test",
      });

      const found = await oauthService.findByClientId(client.clientId);
      expect(found).toBeDefined();
      expect(found?.id).toBe(client.id);
    });

    it("should validate correct credentials", async ({ expect }) => {
      const { oauthService } = await setup();

      const { client, clientSecret } = await oauthService.createClient({
        name: "Auth Test",
      });

      const validated = await oauthService.validateCredentials(
        client.clientId,
        clientSecret,
      );

      expect(validated).toBeDefined();
      expect(validated?.id).toBe(client.id);
    });

    it("should reject invalid secret", async ({ expect }) => {
      const { oauthService } = await setup();

      const { client } = await oauthService.createClient({
        name: "Invalid Secret Test",
      });

      const validated = await oauthService.validateCredentials(
        client.clientId,
        "wrong-secret",
      );

      expect(validated).toBeUndefined();
    });

    it("should reject disabled clients", async ({ expect }) => {
      const { oauthService } = await setup();

      const { client, clientSecret } = await oauthService.createClient({
        name: "Disabled Test",
      });

      await oauthService.updateClient(client.id, { enabled: false });

      const validated = await oauthService.validateCredentials(
        client.clientId,
        clientSecret,
      );

      expect(validated).toBeUndefined();
    });

    it("should rotate client secret", async ({ expect }) => {
      const { oauthService } = await setup();

      const { client, clientSecret: oldSecret } =
        await oauthService.createClient({
          name: "Rotate Test",
        });

      const { clientSecret: newSecret } = await oauthService.rotateSecret(
        client.id,
      );

      expect(newSecret).not.toBe(oldSecret);

      // Old secret should not work
      const oldValidation = await oauthService.validateCredentials(
        client.clientId,
        oldSecret,
      );
      expect(oldValidation).toBeUndefined();

      // New secret should work
      const newValidation = await oauthService.validateCredentials(
        client.clientId,
        newSecret,
      );
      expect(newValidation).toBeDefined();
    });

    it("should delete client", async ({ expect }) => {
      const { oauthService } = await setup();

      const { client } = await oauthService.createClient({
        name: "Delete Test",
      });

      await oauthService.deleteClient(client.id);

      const found = await oauthService.findByClientId(client.clientId);
      expect(found).toBeUndefined();
    });

    it("should list clients", async ({ expect }) => {
      const { oauthService } = await setup();

      await oauthService.createClient({ name: "Client 1" });
      await oauthService.createClient({ name: "Client 2" });
      await oauthService.createClient({ name: "Client 3" });

      const clients = await oauthService.listClients();
      expect(clients.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Scope Checking", () => {
    it("should match exact scope", async ({ expect }) => {
      const { oauthService } = await setup();

      const { client } = await oauthService.createClient({
        name: "Scope Test",
        scopes: ["mcp:tools:read", "mcp:resources:write"],
      });

      expect(oauthService.hasScope(client, "mcp:tools:read")).toBe(true);
      expect(oauthService.hasScope(client, "mcp:resources:write")).toBe(true);
      expect(oauthService.hasScope(client, "mcp:tools:write")).toBe(false);
    });

    it("should match wildcard scope", async ({ expect }) => {
      const { oauthService } = await setup();

      const { client } = await oauthService.createClient({
        name: "Wildcard Test",
        scopes: ["mcp:tools:*"],
      });

      expect(oauthService.hasScope(client, "mcp:tools:read")).toBe(true);
      expect(oauthService.hasScope(client, "mcp:tools:write")).toBe(true);
      expect(oauthService.hasScope(client, "mcp:resources:read")).toBe(false);
    });

    it("should match global wildcard", async ({ expect }) => {
      const { oauthService } = await setup();

      const { client } = await oauthService.createClient({
        name: "Global Test",
        scopes: ["*"],
      });

      expect(oauthService.hasScope(client, "mcp:tools:read")).toBe(true);
      expect(oauthService.hasScope(client, "anything")).toBe(true);
    });

    it("should check multiple scopes", async ({ expect }) => {
      const { oauthService } = await setup();

      const { client } = await oauthService.createClient({
        name: "Multi Scope Test",
        scopes: ["mcp:tools:*", "mcp:resources:read"],
      });

      expect(
        oauthService.hasScopes(client, [
          "mcp:tools:read",
          "mcp:resources:read",
        ]),
      ).toBe(true);
      expect(
        oauthService.hasScopes(client, [
          "mcp:tools:read",
          "mcp:resources:write",
        ]),
      ).toBe(false);
    });
  });

  describe("Token Creation", () => {
    it("should create access token for valid client", async ({ expect }) => {
      const { oauthService, auth } = await setup();

      const { client, clientSecret } = await oauthService.createClient({
        name: "Token Test",
        scopes: ["mcp:tools:*"],
      });

      const tokenResponse = await auth.createClientToken(
        client.clientId,
        clientSecret,
      );

      expect(tokenResponse.access_token).toBeDefined();
      expect(tokenResponse.token_type).toBe("Bearer");
      expect(tokenResponse.expires_in).toBeGreaterThan(0);
      expect(tokenResponse.scope).toBe("mcp:tools:*");
    });

    it("should reject invalid credentials for token", async ({ expect }) => {
      const { oauthService, auth } = await setup();

      const { client } = await oauthService.createClient({
        name: "Invalid Token Test",
      });

      await expect(
        auth.createClientToken(client.clientId, "wrong-secret"),
      ).rejects.toThrowError(McpUnauthorizedError);
    });
  });

  describe("MCP Request Authentication", () => {
    it("should authenticate request with valid token", async ({ expect }) => {
      const { oauthService, auth, provider } = await setup();

      const { client, clientSecret } = await oauthService.createClient({
        name: "MCP Auth Test",
        scopes: ["mcp:tools:*"],
      });

      const { access_token } = await auth.createClientToken(
        client.clientId,
        clientSecret,
      );

      // Make authenticated MCP request
      const authContext = await auth.authenticate({
        headers: {
          authorization: `Bearer ${access_token}`,
        },
      });

      expect(authContext.client).toBeDefined();
      expect(authContext.client?.clientId).toBe(client.clientId);
      expect(authContext.scopes).toContain("mcp:tools:*");
    });

    it("should reject request without token when auth required", async ({
      expect,
    }) => {
      const { auth } = await setup();

      await expect(auth.authenticate({})).rejects.toThrowError(
        McpUnauthorizedError,
      );
    });

    it("should reject request with invalid token", async ({ expect }) => {
      const { auth } = await setup();

      await expect(
        auth.authenticate({
          headers: {
            authorization: "Bearer invalid-token",
          },
        }),
      ).rejects.toThrowError(McpUnauthorizedError);
    });

    it("should allow anonymous when configured", async ({ expect }) => {
      process.env.DATABASE_URL = "pglite://:memory:";
      const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });

      class AnonServer {
        auth = $mcpAuth({
          name: "anon",
          secret: SECRET,
          allowAnonymous: true,
        });
      }

      alepha.with(AlephaSecurity).with(AlephaMcp).with(AnonServer);
      await alepha.start();

      const server = alepha.inject(AnonServer);
      const authContext = await server.auth.authenticate({});

      expect(authContext).toEqual({});
    });
  });

  describe("MCP Tool Integration with Auth", () => {
    it("should call protected tool with auth context", async ({ expect }) => {
      const { oauthService, auth, provider } = await setup();

      const { client, clientSecret } = await oauthService.createClient({
        name: "Tool Auth Test",
        scopes: ["mcp:tools:*"],
      });

      const { access_token } = await auth.createClientToken(
        client.clientId,
        clientSecret,
      );

      // Initialize
      await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      });

      // Get auth context
      const authContext = await auth.authenticate({
        headers: { authorization: `Bearer ${access_token}` },
      });

      // Call protected tool with context
      const response = await provider.handleMessage(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "protectedTool",
            arguments: { message: "Hello" },
          },
        },
        {
          headers: { authorization: `Bearer ${access_token}` },
          data: authContext,
        },
      );

      const result = response?.result as { content: Array<{ text: string }> };
      expect(result.content[0].text).toBe(
        "Protected: Hello (client: Tool Auth Test)",
      );
    });

    it("should reject protected tool without auth", async ({ expect }) => {
      const { provider } = await setup();

      await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      });

      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "protectedTool",
          arguments: { message: "Hello" },
        },
      });

      const result = response?.result as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Authentication required");
    });

    it("should call public tool without auth", async ({ expect }) => {
      const { provider } = await setup();

      await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      });

      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "publicTool",
          arguments: { message: "World" },
        },
      });

      const result = response?.result as { content: Array<{ text: string }> };
      expect(result.content[0].text).toBe("Echo: World");
    });

    it("should enforce scope requirements on tools", async ({ expect }) => {
      const { oauthService, auth, provider } = await setup();

      // Create client without admin scope
      const { client, clientSecret } = await oauthService.createClient({
        name: "Limited Client",
        scopes: ["mcp:tools:basic"],
      });

      const { access_token } = await auth.createClientToken(
        client.clientId,
        clientSecret,
      );

      await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      });

      const authContext = await auth.authenticate({
        headers: { authorization: `Bearer ${access_token}` },
      });

      // Try to call admin tool
      const response = await provider.handleMessage(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "scopedTool",
            arguments: { data: "admin data" },
          },
        },
        {
          headers: { authorization: `Bearer ${access_token}` },
          data: authContext,
        },
      );

      const result = response?.result as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("mcp:admin");
    });

    it("should allow admin scope on restricted tools", async ({ expect }) => {
      const { oauthService, auth, provider } = await setup();

      // Create client with admin scope
      const { client, clientSecret } = await oauthService.createClient({
        name: "Admin Client",
        scopes: ["mcp:admin", "mcp:tools:*"],
      });

      const { access_token } = await auth.createClientToken(
        client.clientId,
        clientSecret,
      );

      await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      });

      const authContext = await auth.authenticate({
        headers: { authorization: `Bearer ${access_token}` },
      });

      // Call admin tool
      const response = await provider.handleMessage(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "scopedTool",
            arguments: { data: "admin data" },
          },
        },
        {
          headers: { authorization: `Bearer ${access_token}` },
          data: authContext,
        },
      );

      const result = response?.result as { content: Array<{ text: string }> };
      expect(result.content[0].text).toBe("Admin operation: admin data");
    });
  });

  describe("Full OAuth2 Client Credentials Flow", () => {
    it("should complete full flow: register → token → call", async ({
      expect,
    }) => {
      const { oauthService, auth, provider } = await setup();

      // 1. Register a new client
      const { client, clientSecret } = await oauthService.createClient({
        name: "Full Flow Client",
        description: "Testing complete OAuth2 flow",
        scopes: ["mcp:tools:*", "mcp:resources:*"],
      });

      expect(client.clientId).toBeDefined();

      // 2. Get access token using client credentials
      const tokenResponse = await auth.createClientToken(
        client.clientId,
        clientSecret,
      );

      expect(tokenResponse.access_token).toBeDefined();
      expect(tokenResponse.token_type).toBe("Bearer");

      // 3. Initialize MCP connection
      const initResponse = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "oauth-client", version: "1.0.0" },
        },
      });

      expect(initResponse?.result).toBeDefined();

      // 4. Authenticate and call protected tool
      const authContext = await auth.authenticate({
        headers: { authorization: `Bearer ${tokenResponse.access_token}` },
      });

      const toolResponse = await provider.handleMessage(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "protectedTool",
            arguments: { message: "OAuth2 works!" },
          },
        },
        {
          headers: { authorization: `Bearer ${tokenResponse.access_token}` },
          data: authContext,
        },
      );

      const result = toolResponse?.result as {
        content: Array<{ text: string }>;
      };
      expect(result.content[0].text).toContain("Protected: OAuth2 works!");
      expect(result.content[0].text).toContain("Full Flow Client");
    });
  });
});
