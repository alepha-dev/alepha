import { createHash, randomBytes } from "node:crypto";
import { Alepha, z } from "alepha";
import { ApiKeyController } from "alepha/api/keys";
import { oauthOptions } from "alepha/api/oauth";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { SessionController } from "../src/api/controllers/SessionController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";

/**
 * End-to-end coverage for the OAuth 2.1 authorization server that backs MCP
 * authentication. Mirrors the harness of `mcp-security.spec.ts`.
 */

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  baseUrl: string;
  adminUserController: AdminUserController;
  apiKeyController: ApiKeyController;
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

  // Mirror `main.server.ts`: configure the OAuth server before `LoreApi`
  // (which holds the `$realm` that merges this value).
  alepha.set(oauthOptions, {
    realm: "default",
    resource: "/mcp",
    loginPath: "/auth/login",
  });

  alepha.with(LoreApi);
  alepha.with(LoreMcp);

  await alepha.start();

  const server = alepha.inject(NodeHttpServerProvider);

  return {
    alepha,
    baseUrl: server.hostname,
    adminUserController: alepha.inject(AdminUserController),
    apiKeyController: alepha.inject(ApiKeyController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

async function createTestUser(
  ctx: TestContext,
): Promise<{ id: string; roles: string[] }> {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
}

async function createApiKey(
  ctx: TestContext,
  user: { id: string; roles: string[] },
): Promise<string> {
  const response = await ctx.apiKeyController.createApiKey.fetch(
    { body: { name: "OAuth Test Key" } },
    { user },
  );
  return response.data.token;
}

/**
 * Register an OAuth client via RFC 7591 dynamic client registration.
 */
async function registerClient(
  baseUrl: string,
  redirectUri = "https://claude.ai/cb",
): Promise<string> {
  const res = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: [redirectUri],
    }),
  });
  const body = (await res.json()) as { client_id: string };
  return body.client_id;
}

/**
 * A fresh PKCE verifier/challenge pair (RFC 7636, S256).
 */
function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * Run the consent decision (POST /oauth/authorize) as an authenticated user
 * and return the issued authorization code.
 */
async function authorize(
  baseUrl: string,
  apiKey: string,
  params: {
    clientId: string;
    redirectUri: string;
    challenge: string;
  },
): Promise<string> {
  const res = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Bearer ${apiKey}`,
    },
    body: new URLSearchParams({
      decision: "allow",
      response_type: "code",
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      code_challenge: params.challenge,
      code_challenge_method: "S256",
      scope: "mcp",
      state: "test-state",
    }),
  });
  const location = res.headers.get("location") ?? "";
  return new URL(location).searchParams.get("code") ?? "";
}

/**
 * Exchange an authorization code at the token endpoint.
 */
async function exchange(
  baseUrl: string,
  body: Record<string, string>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

describe("OAuth 2.1 authorization server", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("serves RFC 8414 authorization-server metadata", async ({ expect }) => {
    const res = await fetch(
      `${ctx.baseUrl}/.well-known/oauth-authorization-server`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(String(body.token_endpoint)).toMatch(/\/oauth\/token$/);
    expect(String(body.registration_endpoint)).toMatch(/\/oauth\/register$/);
    expect(body.code_challenge_methods_supported).toContain("S256");
  });

  it("serves RFC 9728 protected-resource metadata", async ({ expect }) => {
    const res = await fetch(
      `${ctx.baseUrl}/.well-known/oauth-protected-resource`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(String(body.resource)).toMatch(/\/mcp$/);
    expect(Array.isArray(body.authorization_servers)).toBe(true);
    expect((body.authorization_servers as unknown[]).length).toBeGreaterThan(0);
  });

  it("registers a client via dynamic client registration", async ({
    expect,
  }) => {
    const res = await fetch(`${ctx.baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { client_id: string };
    expect(body.client_id).toMatch(/^mcp_/);
  });

  it("rejects an authorize request from an unknown client", async ({
    expect,
  }) => {
    const { challenge } = pkce();
    const res = await fetch(
      `${ctx.baseUrl}/oauth/authorize?response_type=code` +
        `&client_id=bogus&redirect_uri=${encodeURIComponent("https://claude.ai/cb")}` +
        `&code_challenge=${challenge}&code_challenge_method=S256`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(400);
  });

  it("redirects an unauthenticated authorize request to login", async ({
    expect,
  }) => {
    const clientId = await registerClient(ctx.baseUrl);
    const { challenge } = pkce();
    const res = await fetch(
      `${ctx.baseUrl}/oauth/authorize?response_type=code` +
        `&client_id=${clientId}&redirect_uri=${encodeURIComponent("https://claude.ai/cb")}` +
        `&code_challenge=${challenge}&code_challenge_method=S256`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toMatch(/^\/auth\/login\?/);
  });

  it("completes the full authorize → token → MCP flow", async ({ expect }) => {
    const redirectUri = "https://claude.ai/cb";
    const clientId = await registerClient(ctx.baseUrl, redirectUri);
    const user = await createTestUser(ctx);
    const apiKey = await createApiKey(ctx, user);
    const { verifier, challenge } = pkce();

    const code = await authorize(ctx.baseUrl, apiKey, {
      clientId,
      redirectUri,
      challenge,
    });
    expect(code.length).toBeGreaterThan(0);

    const token = await exchange(ctx.baseUrl, {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    expect(token.status).toBe(200);
    expect(token.json.token_type).toBe("Bearer");
    const accessToken = String(token.json.access_token);
    expect(accessToken.length).toBeGreaterThan(0);

    // The access token is a realm JWT — the existing /mcp JWT resolver must
    // accept it with no transport changes.
    const mcp = await fetch(`${ctx.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "campaign_list", arguments: {} },
      }),
    });
    const mcpBody = (await mcp.json()) as {
      error?: unknown;
      result?: { isError?: boolean };
    };
    expect(mcpBody.error).toBeUndefined();
    expect(mcpBody.result?.isError).not.toBe(true);
  });

  it("tags the session with the OAuth client and lists it as a connection", async ({
    expect,
  }) => {
    const redirectUri = "https://claude.ai/cb";
    const clientId = await registerClient(ctx.baseUrl, redirectUri);
    const user = await createTestUser(ctx);
    const apiKey = await createApiKey(ctx, user);
    const { verifier, challenge } = pkce();

    const code = await authorize(ctx.baseUrl, apiKey, {
      clientId,
      redirectUri,
      challenge,
    });
    const token = await exchange(ctx.baseUrl, {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    expect(token.status).toBe(200);

    // The session minted by the token exchange must be tagged with the
    // OAuth client and surface under the user's connected apps.
    const sessions = ctx.alepha.inject(SessionController);
    const connections = await sessions.getMyConnections.fetch({}, { user });
    expect(connections.data).toHaveLength(1);
    expect(connections.data[0].clientId).toBe(clientId);
    expect(connections.data[0].clientName).toBe("Claude");
  });

  it("refreshes an access token via the refresh_token grant", async ({
    expect,
  }) => {
    const redirectUri = "https://claude.ai/cb";
    const clientId = await registerClient(ctx.baseUrl, redirectUri);
    const user = await createTestUser(ctx);
    const apiKey = await createApiKey(ctx, user);
    const { verifier, challenge } = pkce();

    const code = await authorize(ctx.baseUrl, apiKey, {
      clientId,
      redirectUri,
      challenge,
    });
    const token = await exchange(ctx.baseUrl, {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    expect(token.status).toBe(200);
    const refreshToken = String(token.json.refresh_token);
    expect(refreshToken.length).toBeGreaterThan(0);

    // The refresh_token grant must mint a fresh access token without
    // re-running the authorization flow.
    const refreshed = await exchange(ctx.baseUrl, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.json.token_type).toBe("Bearer");
    expect(String(refreshed.json.access_token).length).toBeGreaterThan(0);
  });

  it("rejects a replayed authorization code", async ({ expect }) => {
    const redirectUri = "https://claude.ai/cb";
    const clientId = await registerClient(ctx.baseUrl, redirectUri);
    const user = await createTestUser(ctx);
    const apiKey = await createApiKey(ctx, user);
    const { verifier, challenge } = pkce();

    const code = await authorize(ctx.baseUrl, apiKey, {
      clientId,
      redirectUri,
      challenge,
    });
    const body = {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    };

    const first = await exchange(ctx.baseUrl, body);
    expect(first.status).toBe(200);

    const replay = await exchange(ctx.baseUrl, body);
    expect(replay.status).toBe(400);
    expect(replay.json.error).toBe("invalid_grant");
  });

  it("rejects a wrong PKCE verifier", async ({ expect }) => {
    const redirectUri = "https://claude.ai/cb";
    const clientId = await registerClient(ctx.baseUrl, redirectUri);
    const user = await createTestUser(ctx);
    const apiKey = await createApiKey(ctx, user);
    const { challenge } = pkce();

    const code = await authorize(ctx.baseUrl, apiKey, {
      clientId,
      redirectUri,
      challenge,
    });

    const wrong = await exchange(ctx.baseUrl, {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: randomBytes(32).toString("base64url"),
    });
    expect(wrong.status).toBe(400);
    expect(wrong.json.error).toBe("invalid_grant");
  });
});
