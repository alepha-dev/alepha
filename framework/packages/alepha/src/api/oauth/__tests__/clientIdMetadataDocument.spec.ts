import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $issuer, type UserAccount } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { AlephaOAuth, oauthOptions } from "../index.ts";
import { OAuthClientService } from "../services/OAuthClientService.ts";

/**
 * Client ID Metadata Documents (MCP 2026-07-28): a `client_id` that is an
 * https URL is fetched, validated and registered as a `source: "cimd"`
 * client, cached under the response's max-age. And DCR's
 * `application_type` (SEP-837).
 */

/**
 * The network, substituted: each URL answers what the spec put there, and
 * every request is counted.
 */
class TestOAuthClientService extends OAuthClientService {
  public responses = new Map<string, () => Response>();
  public requested: string[] = [];

  protected async requestMetadataDocument(url: URL): Promise<Response> {
    this.requested.push(url.toString());
    const answer = this.responses.get(url.toString());
    if (!answer) throw new Error("network unreachable");
    return answer();
  }

  public testFetch(clientId: string) {
    return this.fetchMetadataDocument(clientId);
  }
}

const CLIENT_ID = "https://app.example/oauth/client.json";
const REDIRECT = "https://app.example/callback";

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });

const document = (overrides: Record<string, unknown> = {}) => ({
  client_id: CLIENT_ID,
  client_name: "Example App",
  redirect_uris: [REDIRECT],
  ...overrides,
});

const boot = async (cimd?: boolean) => {
  class App {
    issuer = $issuer({ name: "users", secret: "test-secret" });
  }
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaServer)
    .with(AlephaOrmPostgres)
    .with({ provide: OAuthClientService, use: TestOAuthClientService })
    .with(AlephaOAuth);
  alepha.set(oauthOptions, {
    realm: "users",
    resource: "/mcp",
    loginPath: "/login",
    ...(cimd === undefined ? {} : { clientIdMetadataDocuments: cimd }),
  });
  const app = alepha.inject(App);
  await alepha.start();
  const service = alepha.inject(TestOAuthClientService);
  service.registerIssuer(
    "users",
    app.issuer,
    async (id) => ({ id, roles: [] }) as UserAccount,
  );
  const { hostname } = alepha.inject(ServerProvider);
  const session = async () =>
    (
      await app.issuer.createToken({
        id: randomUUID(),
        roles: [],
        name: "Ada",
      } as UserAccount)
    ).access_token;
  const authorize = async (clientId = CLIENT_ID, redirectUri = REDIRECT) =>
    fetch(
      `${hostname}/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: "x".repeat(43),
        code_challenge_method: "S256",
      })}`,
      {
        redirect: "manual",
        headers: { authorization: `Bearer ${await session()}` },
      },
    );
  return { alepha, service, hostname, authorize };
};

describe("CIMD: discovery", () => {
  it("advertises client_id_metadata_document_supported by default", async () => {
    const { alepha, hostname } = await boot();

    const as = (await (
      await fetch(`${hostname}/.well-known/oauth-authorization-server`)
    ).json()) as any;
    const oidc = (await (
      await fetch(`${hostname}/.well-known/openid-configuration`)
    ).json()) as any;

    expect(as.client_id_metadata_document_supported).toBe(true);
    expect(oidc.client_id_metadata_document_supported).toBe(true);
    await alepha.stop();
  });

  it("stops advertising and resolving when clientIdMetadataDocuments is false", async () => {
    const { alepha, service, hostname, authorize } = await boot(false);
    service.responses.set(CLIENT_ID, () => json(document()));

    const as = (await (
      await fetch(`${hostname}/.well-known/oauth-authorization-server`)
    ).json()) as any;
    const res = await authorize();

    expect(as).not.toHaveProperty("client_id_metadata_document_supported");
    expect(res.status).toBe(400);
    expect(service.requested).toEqual([]);
    await alepha.stop();
  });
});

describe("CIMD: resolving a URL client id", () => {
  it("registers the client from its document and shows its host on consent", async () => {
    const { alepha, service, authorize } = await boot();
    service.responses.set(CLIENT_ID, () => json(document()));

    const res = await authorize();

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Example App");
    expect(html).toContain("Client published by");
    expect(html).toContain("app.example");
    const row = await service.findByClientId(CLIENT_ID);
    expect(row?.source).toBe("cimd");
    expect(row?.type).toBe("public");
    expect(row?.redirectUris).toEqual([REDIRECT]);
    await alepha.stop();
  });

  it("caches the document under max-age, clamped to at least 5 minutes", async () => {
    const { alepha, service, authorize } = await boot();
    service.responses.set(CLIENT_ID, () =>
      json(document(), { "cache-control": "max-age=60" }),
    );

    await authorize();
    await authorize();
    expect(service.requested).toHaveLength(1);

    await alepha.inject(DateTimeProvider).travel(6, "minutes");
    await authorize();
    expect(service.requested).toHaveLength(2);
    await alepha.stop();
  });

  it("serves the stored copy when a refetch fails, for at most 24 h past expiry", async () => {
    const { alepha, service, authorize } = await boot();
    service.responses.set(CLIENT_ID, () => json(document()));
    await authorize();
    service.responses.delete(CLIENT_ID);
    const dt = alepha.inject(DateTimeProvider);

    await dt.travel(1, "hours");
    expect((await authorize()).status).toBe(200);

    await dt.travel(25, "hours");
    expect((await authorize()).status).toBe(400);
    await alepha.stop();
  });

  it("refuses a document whose client_id is not its URL, or that lacks a name or redirects", async () => {
    const { alepha, service, authorize } = await boot();

    for (const bad of [
      document({ client_id: "https://evil.example/client.json" }),
      document({ client_name: "" }),
      document({ redirect_uris: [] }),
      document({ token_endpoint_auth_method: "client_secret_post" }),
      document({ redirect_uris: ["http://app.example/callback"] }),
    ]) {
      service.responses.set(CLIENT_ID, () => json(bad));
      expect((await authorize()).status).toBe(400);
    }
    expect(await service.findByClientId(CLIENT_ID)).toBeNull();
    await alepha.stop();
  });

  it("requires the redirect to match the document exactly", async () => {
    const { alepha, service, authorize } = await boot();
    service.responses.set(CLIENT_ID, () => json(document()));

    const res = await authorize(CLIENT_ID, "https://app.example/other");

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("redirect_uri not registered");
    await alepha.stop();
  });

  it("accepts a native client's port-less loopback redirects without application_type, on any port", async () => {
    // The shape Claude Code publishes: no application_type, loopback
    // redirects without a port, and a random port at authorize (RFC 8252).
    const { alepha, service, authorize } = await boot();
    service.responses.set(CLIENT_ID, () =>
      json(
        document({
          client_name: "Claude Code",
          redirect_uris: [
            "http://localhost/callback",
            "http://127.0.0.1/callback",
          ],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      ),
    );

    const res = await authorize(CLIENT_ID, "http://localhost:57336/callback");

    expect(res.status).toBe(200);
    const row = await service.findByClientId(CLIENT_ID);
    expect(row?.source).toBe("cimd");
    expect(row?.applicationType).toBeUndefined();
    await alepha.stop();
  });

  it("accepts a native client's dot-less private-use scheme, as GitHub Copilot publishes", async () => {
    // GitHub Copilot desktop's document, as served on 2026-11-06: its
    // `github-app` scheme carries no dot, which RFC 8252 only recommends.
    const { alepha, service, authorize } = await boot();
    service.responses.set(CLIENT_ID, () =>
      json(
        document({
          client_name: "GitHub Copilot",
          client_uri: "https://app.example/app",
          application_type: "native",
          grant_types: [
            "authorization_code",
            "refresh_token",
            "urn:ietf:params:oauth:grant-type:device_code",
          ],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          redirect_uris: [
            "github-app://oauth/callback",
            "http://127.0.0.1/",
            "http://127.0.0.1/callback",
          ],
        }),
      ),
    );

    const custom = await authorize(CLIENT_ID, "github-app://oauth/callback");
    const loopback = await authorize(
      CLIENT_ID,
      "http://127.0.0.1:51234/callback",
    );

    expect(custom.status).toBe(200);
    expect(loopback.status).toBe(200);
    const row = await service.findByClientId(CLIENT_ID);
    expect(row?.applicationType).toBe("native");
    await alepha.stop();
  });

  it("refuses a native document naming a script or local scheme", async () => {
    const { alepha, service, authorize } = await boot();
    for (const uri of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
    ]) {
      service.responses.set(CLIENT_ID, () =>
        json(document({ application_type: "native", redirect_uris: [uri] })),
      );
      expect((await authorize(CLIENT_ID, uri)).status, uri).toBe(400);
      expect(await service.findByClientId(CLIENT_ID), uri).toBeNull();
    }
    expect(service.requested).toHaveLength(3);
    await alepha.stop();
  });

  it("still refuses a loopback redirect when the document says web", async () => {
    const { alepha, service, authorize } = await boot();
    service.responses.set(CLIENT_ID, () =>
      json(
        document({
          redirect_uris: ["http://localhost/callback"],
          application_type: "web",
        }),
      ),
    );

    expect(
      (await authorize(CLIENT_ID, "http://localhost/callback")).status,
    ).toBe(400);
    await alepha.stop();
  });

  it("refuses a redirect, a non-JSON answer and a body over 5 KiB", async () => {
    const { alepha, service, authorize } = await boot();

    for (const answer of [
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/" },
        }),
      () =>
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      () => json({ ...document(), padding: "x".repeat(6 * 1024) }),
    ]) {
      service.responses.set(CLIENT_ID, answer);
      expect((await authorize()).status).toBe(400);
    }
    await alepha.stop();
  });
});

describe("CIMD: the fetch guard", () => {
  it("never fetches a host that could be private", async () => {
    const { alepha, service } = await boot();

    for (const url of [
      "http://app.example/client.json",
      "https://app.example:8443/client.json",
      "https://127.0.0.1/client.json",
      "https://[::1]/client.json",
      "https://localhost/client.json",
      "https://printer.local/client.json",
      "https://db.internal/client.json",
      "https://app.localhost/client.json",
      "https://intranet/client.json",
    ]) {
      await expect(service.testFetch(url)).rejects.toThrow();
    }
    expect(service.requested).toEqual([]);
    await alepha.stop();
  });
});

describe("DCR: application_type", () => {
  const register = (hostname: string, body: Record<string, unknown>) =>
    fetch(`${hostname}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: `App ${randomUUID()}`, ...body }),
    });

  it("stores it and echoes it", async () => {
    const { alepha, service, hostname } = await boot();

    const res = await register(hostname, {
      redirect_uris: ["http://127.0.0.1:4567/cb"],
      application_type: "native",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.application_type).toBe("native");
    expect(
      (await service.findByClientId(body.client_id))?.applicationType,
    ).toBe("native");
    await alepha.stop();
  });

  it("refuses a loopback redirect for a web client", async () => {
    const { alepha, hostname } = await boot();

    const res = await register(hostname, {
      redirect_uris: ["http://127.0.0.1:4567/cb"],
      application_type: "web",
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("invalid_redirect_uri");
    await alepha.stop();
  });

  it("accepts a private-use scheme for a native client only", async () => {
    const { alepha, hostname } = await boot();
    const redirect_uris = ["com.example.app:/oauth/callback"];

    const native = await register(hostname, {
      redirect_uris,
      application_type: "native",
    });
    const web = await register(hostname, {
      redirect_uris,
      application_type: "web",
    });
    const absent = await register(hostname, { redirect_uris });

    expect(native.status).toBe(201);
    expect(web.status).toBe(400);
    expect(absent.status).toBe(400);
    await alepha.stop();
  });

  it("keeps the general rule when absent, so older native clients still register", async () => {
    const { alepha, hostname } = await boot();

    const res = await register(hostname, {
      redirect_uris: ["http://127.0.0.1:4567/cb"],
    });

    expect(res.status).toBe(201);
    expect((await res.json()) as any).not.toHaveProperty("application_type");
    await alepha.stop();
  });
});
