import { createHash, randomUUID } from "node:crypto";

import { Alepha, z } from "alepha";
import { OAuthClientService, oauthOptions } from "alepha/api/oauth";
import { AlephaEmail } from "alepha/email";
import { $tool, AlephaMcp, StreamableHttpMcpTransport } from "alepha/mcp";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $secure, AlephaSecurity } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { $realm, AlephaApiUsers, RealmProvider } from "../index.ts";

/**
 * The MCP endpoint's authorization challenges, through a real realm: the 401
 * names the scopes to ask for, a token missing a scope a tool needs gets 403
 * `insufficient_scope` before routing, and the authorization server returns
 * RFC 9207 `iss` and lists the declared scopes.
 */
class TestApp {
  realm = $realm({ features: { oauth: true } });

  readDocs = $tool({
    name: "read_docs",
    description: "Read",
    use: [$secure({ permissions: ["docs:read"] })],
    schema: { params: z.object({}), result: z.text() },
    handler: async () => "READ",
  });

  writeDocs = $tool({
    name: "write_docs",
    description: "Write",
    use: [$secure({ permissions: ["docs:write"] })],
    schema: { params: z.object({}), result: z.text() },
    handler: async () => "WRITTEN",
  });

  adminDocs = $tool({
    name: "admin_docs",
    description: "Admin only",
    use: [$secure({ permissions: ["admin:docs"] })],
    schema: { params: z.object({}), result: z.text() },
    handler: async () => "ADMIN",
  });
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error", SERVER_PORT: 0 } })
    .with(AlephaServer)
    .with(AlephaOrmPostgres)
    .with(AlephaSecurity)
    .with(AlephaEmail)
    .with(AlephaApiUsers)
    .with(AlephaMcp)
    .with(StreamableHttpMcpTransport);
  alepha.set(oauthOptions, {
    ...oauthOptions.options.default,
    scopes: {
      read: { label: "Read", permissions: ["docs:read"] },
      write: { label: "Write", permissions: ["docs:write"] },
      admin: { label: "Admin", permissions: ["admin:docs"] },
      openid: { label: "Identity", permissions: [] },
    },
  });
  alepha.inject(TestApp);
  await alepha.start();

  const { hostname } = alepha.inject(ServerProvider);
  const oauth = alepha.inject(OAuthClientService);
  const username = `challenge-${randomUUID().slice(0, 8)}`;
  // A role that may read and write but not administer: `admin:docs` is
  // refused by the roles, so no scope can help with it.
  const user = await alepha
    .inject(RealmProvider)
    .userRepository()
    .create({ username, email: `${username}@example.com`, roles: ["user"] });
  const redirectUri = "https://challenge.example.com/callback";
  const client = await oauth.register({
    realm: "users",
    clientName: `Challenge ${randomUUID()}`,
    redirectUris: [redirectUri],
    scopes: ["read", "write", "admin", "openid"],
  });

  const grant = async (scopes: string[]) => {
    const verifier = `verifier-${randomUUID()}`;
    const code = await oauth.createAuthorizationCode("users", {
      userId: user.id,
      clientId: client.clientId,
      redirectUri,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      scopes,
    });
    const res = await fetch(`${hostname}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: client.clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as Record<string, string>).access_token!;
  };

  const call = (name: string, token?: string, progress = false) =>
    fetch(`${hostname}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name,
          arguments: {},
          ...(progress ? { _meta: { progressToken: "p" } } : {}),
        },
      }),
    });

  return { alepha, hostname, client, redirectUri, grant, call };
};

describe("MCP authorization challenges", () => {
  it("names the declared non-identity scopes on the 401", async () => {
    const { alepha, call } = await setup();

    const res = await call("read_docs");

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(
      /^Bearer resource_metadata="https?:\/\/[^"]+\/\.well-known\/oauth-protected-resource", scope="read write admin"$/,
    );
    await alepha.stop();
  });

  it("answers 403 insufficient_scope with the grant's scopes plus the missing one", async () => {
    const { alepha, grant, call } = await setup();
    const token = await grant(["read", "openid"]);

    const res = await call("write_docs", token);

    expect(res.status).toBe(403);
    const header = res.headers.get("www-authenticate") ?? "";
    expect(header).toContain('Bearer error="insufficient_scope"');
    expect(header).toContain('scope="read openid write"');
    expect(header).toContain("resource_metadata=");
    expect(header).toContain("error_description=");
    await alepha.stop();
  });

  it("answers 403 before a progress stream opens", async () => {
    const { alepha, grant, call } = await setup();
    const token = await grant(["read"]);

    const res = await call("write_docs", token, true);

    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/json");
    await alepha.stop();
  });

  it("serves a call the grant already covers", async () => {
    const { alepha, grant, call } = await setup();
    const token = await grant(["read"]);

    const res = await call("read_docs", token);

    expect(res.status).toBe(200);
    expect(((await res.json()) as any).result.content[0].text).toBe("READ");
    await alepha.stop();
  });

  it("keeps today's refusal when the user's roles refuse it: no scope can help", async () => {
    const { alepha, grant, call } = await setup();
    const token = await grant(["read"]);

    const res = await call("admin_docs", token);

    expect(res.status).toBe(200);
    expect(res.headers.get("www-authenticate")).toBeNull();
    // What a `$secure` refusal inside a tool has always been: a tool error
    // the model reads, not a challenge a client can act on.
    const body = (await res.json()) as any;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("admin:docs");
    await alepha.stop();
  });
});

describe("OAuth authorization server: iss and declared scopes", () => {
  it("lists the declared scopes and advertises iss in both metadata documents", async () => {
    const { alepha, hostname } = await setup();

    const as = (await (
      await fetch(`${hostname}/.well-known/oauth-authorization-server`)
    ).json()) as any;
    const prm = (await (
      await fetch(`${hostname}/.well-known/oauth-protected-resource`)
    ).json()) as any;

    expect(as.scopes_supported).toEqual(["read", "write", "admin", "openid"]);
    expect(prm.scopes_supported).toEqual(["read", "write", "admin", "openid"]);
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
    await alepha.stop();
  });

  it("returns iss on an authorization error redirect", async () => {
    const { alepha, hostname, client, redirectUri } = await setup();

    const res = await fetch(
      `${hostname}/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: redirectUri,
        code_challenge: "x".repeat(43),
        code_challenge_method: "S256",
        prompt: "none",
      })}`,
      { redirect: "manual" },
    );

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("error")).toBe("login_required");
    expect(location.searchParams.get("iss")).toBe(new URL(hostname).origin);
    await alepha.stop();
  });
});
