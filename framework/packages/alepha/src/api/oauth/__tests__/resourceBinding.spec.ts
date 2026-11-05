import { createHash, randomUUID } from "node:crypto";

import { Alepha, z } from "alepha";
import { $tool, AlephaMcp, StreamableHttpMcpTransport } from "alepha/mcp";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $issuer, type UserAccount } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { AlephaOAuth, oauthOptions } from "../index.ts";
import { OAuthClientService } from "../services/OAuthClientService.ts";

/**
 * RFC 8707 audience binding: an OAuth access token is bound to the MCP
 * resource it was issued for (`aud: [realm, resource]`), keeps that binding
 * across refresh, and the MCP endpoint refuses a token bound elsewhere.
 */

class Ping {
  ping = $tool({
    description: "Ping",
    schema: { params: z.object({}), result: z.text() },
    handler: async () => "pong",
  });
}

const decode = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());

const boot = async () => {
  const sessions = new Map<
    string,
    { userId: string; clientId?: string; resource?: string }
  >();

  class App {
    issuer = $issuer({
      name: "users",
      secret: "test-secret",
      settings: {
        onCreateSession: async (user, config) => {
          const refreshToken = randomUUID();
          sessions.set(refreshToken, {
            userId: user.id,
            clientId: config.clientId,
            resource: config.resource,
          });
          return { refreshToken, sessionId: randomUUID() };
        },
        onRefreshSession: async (refreshToken) => {
          const session = sessions.get(refreshToken);
          if (!session) throw new Error("unknown refresh token");
          return {
            user: { id: session.userId, roles: [] } as UserAccount,
            expiresIn: 3600,
            clientId: session.clientId,
            resource: session.resource,
          };
        },
      },
    });
  }

  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaServer)
    .with(AlephaOrmPostgres)
    .with(AlephaOAuth)
    .with(AlephaMcp)
    .with(StreamableHttpMcpTransport)
    .with(Ping);
  alepha.set(oauthOptions, {
    realm: "users",
    resource: "/mcp",
    loginPath: "/login",
  });
  const app = alepha.inject(App);
  await alepha.start();

  const service = alepha.inject(OAuthClientService);
  service.registerIssuer(
    "users",
    app.issuer,
    async (id) => ({ id, roles: [] }) as UserAccount,
  );
  const { hostname } = alepha.inject(ServerProvider);
  const declared = `${hostname}/mcp`;

  const redirectUri = "https://client.example/cb";
  const client = await service.register({
    realm: "users",
    clientName: "Bound Client",
    redirectUris: [redirectUri],
    scopes: ["mcp"],
  });
  const clientId = client.clientId;

  const verifier = "the-code-verifier-value-1234567890-abcdef";
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const code = (resource?: string) =>
    service.createAuthorizationCode("users", {
      userId: randomUUID(),
      clientId,
      redirectUri,
      codeChallenge: challenge,
      scopes: ["mcp"],
      resource,
    });

  const token = (params: Record<string, string>) =>
    fetch(`${hostname}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        ...params,
      }).toString(),
    });

  const exchange = async (resource?: string) => {
    const res = await token({
      grant_type: "authorization_code",
      code: await code(resource),
      code_verifier: verifier,
    });
    return (await res.json()) as Record<string, any>;
  };

  const session = async () =>
    (await app.issuer.createToken({ id: "user-1", roles: [] } as UserAccount))
      .access_token;

  const authorize = async (resource?: string) =>
    fetch(
      `${hostname}/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        ...(resource !== undefined ? { resource } : {}),
      })}`,
      {
        redirect: "manual",
        headers: { authorization: `Bearer ${await session()}` },
      },
    );

  const callMcp = (accessToken: string) =>
    fetch(`${hostname}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });

  return {
    alepha,
    app,
    hostname,
    declared,
    exchange,
    token,
    authorize,
    callMcp,
  };
};

describe("RFC 8707: binding a token to the resource", () => {
  it("binds a grant that names no resource to the declared one", async () => {
    const { alepha, declared, exchange } = await boot();

    const body = await exchange();

    expect(decode(body.access_token).aud).toEqual(["users", declared]);
    await alepha.stop();
  });

  it("binds a grant naming the declared resource, after normalisation", async () => {
    const { alepha, declared, exchange } = await boot();
    const url = new URL(declared);
    const spelled = `${url.protocol}//${url.host.toUpperCase()}${url.pathname}/`;

    const body = await exchange(spelled);

    expect(decode(body.access_token).aud).toEqual(["users", declared]);
    await alepha.stop();
  });

  it("keeps the binding across a refresh", async () => {
    const { alepha, declared, exchange, token } = await boot();
    const first = await exchange();

    const res = await token({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
    });
    const refreshed = (await res.json()) as Record<string, any>;

    expect(res.status).toBe(200);
    expect(decode(refreshed.access_token).aud).toEqual(["users", declared]);
    await alepha.stop();
  });

  it("answers invalid_target at /oauth/authorize for another resource", async () => {
    const { alepha, authorize } = await boot();

    const res = await authorize("https://elsewhere.example/mcp");

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("https://client.example");
    expect(location.searchParams.get("error")).toBe("invalid_target");
    await alepha.stop();
  });

  it("renders consent with the canonical resource when it names the declared one", async () => {
    const { alepha, authorize, declared } = await boot();

    const res = await authorize(`${declared}/`);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`value="${declared}"`);
    await alepha.stop();
  });

  it("answers invalid_target at /oauth/token for another resource, spending nothing", async () => {
    const { alepha, token } = await boot();

    const res = await token({
      grant_type: "authorization_code",
      code: "irrelevant",
      code_verifier: "irrelevant",
      resource: "https://elsewhere.example/mcp",
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("invalid_target");
    await alepha.stop();
  });

  it("answers invalid_target at /oauth/device_authorization for another resource", async () => {
    const { alepha, hostname } = await boot();

    const res = await fetch(`${hostname}/oauth/device_authorization`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "cli",
        resource: "https://elsewhere.example/mcp",
      }).toString(),
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("invalid_target");
    await alepha.stop();
  });
});

describe("RFC 8707: the MCP endpoint checks the audience", () => {
  it("serves a token bound to this endpoint", async () => {
    const { alepha, exchange, callMcp } = await boot();

    const body = await exchange();

    expect((await callMcp(body.access_token)).status).toBe(200);
    await alepha.stop();
  });

  it("refuses a token bound to another resource with 401 and the resource_metadata challenge", async () => {
    const { alepha, app, callMcp } = await boot();
    const { access_token } = await app.issuer.createToken(
      { id: "user-1", roles: [] } as UserAccount,
      { sid: "s", refresh_token: "r" },
      { clientId: "c", resource: "https://elsewhere.example/mcp" },
    );

    const res = await callMcp(access_token);

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(
      /^Bearer resource_metadata="https?:\/\/.+\/\.well-known\/oauth-protected-resource"$/,
    );
    await alepha.stop();
  });

  it("serves tokens bound to no resource: a first-party login and a pre-binding OAuth session", async () => {
    const { alepha, app, callMcp } = await boot();
    const firstParty = await app.issuer.createToken(
      { id: "user-1", roles: [] } as UserAccount,
      { sid: "s", refresh_token: "r" },
    );
    const legacyOAuth = await app.issuer.createToken(
      { id: "user-1", roles: [] } as UserAccount,
      { sid: "s", refresh_token: "r" },
      { clientId: "c" },
    );

    expect(decode(legacyOAuth.access_token).aud).toBe("users");
    expect((await callMcp(firstParty.access_token)).status).toBe(200);
    expect((await callMcp(legacyOAuth.access_token)).status).toBe(200);
    await alepha.stop();
  });
});
