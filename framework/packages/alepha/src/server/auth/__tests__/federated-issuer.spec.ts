import { Alepha, z } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { $issuer, $secure } from "alepha/security";
import { $route, ServerProvider } from "alepha/server";
import { MockOidcServer } from "alepha/testing/oidc";
import { describe, expect, it } from "vitest";

import { $auth } from "../primitives/$auth.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";

/**
 * A federated `$issuer` checks `iss` and the client (`aud`, else `azp`), not
 * only the signature and the expiry. On a shared IdP realm every client's
 * tokens are signed with the same keys, so the signature alone lets a token
 * minted for another client authenticate here.
 */

class Routes {
  me = $route({
    path: "/me",
    use: [$secure()],
    schema: { response: z.object({ id: z.text() }) },
    handler: ({ user }) => ({ id: user!.id }),
  });

  session = $route({
    path: "/session-only",
    use: [$secure({ sessionOnly: true })],
    schema: { response: z.object({ id: z.text() }) },
    handler: ({ user }) => ({ id: user!.id }),
  });
}

const start = async (App: new () => object, env: Record<string, any> = {}) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error", ...env } });
  alepha.with(App);
  alepha.with(ServerAuthProvider);
  await alepha.start();
  const hostname = alepha.inject(ServerProvider).hostname;
  const get = (path: string, token: string) =>
    fetch(`${hostname}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  return { alepha, hostname, get };
};

const bootOidc = (idp: MockOidcServer | { issuer: string }) => {
  class App extends Routes {
    keycloak = $auth({
      oidc: { issuer: idp.issuer, clientId: "alepha" },
    });
    issuer = $issuer({ name: "keycloak", oidc: () => this.keycloak });
  }
  return start(App);
};

const twoClients = () =>
  MockOidcServer.start({
    clients: [{ clientId: "alepha" }, { clientId: "other" }],
  });

describe("$issuer({ oidc })", () => {
  it("accepts a token whose azp names the client, the Keycloak default", async () => {
    const idp = await twoClients();
    const { get } = await bootOidc(idp);

    const token = await idp.provider.createAccessToken({ clientId: "alepha" });
    const response = await get("/me", token);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "user-1" });
  });

  it("refuses a token minted for another client of the same IdP", async () => {
    const idp = await twoClients();
    const { get } = await bootOidc(idp);

    const token = await idp.provider.createAccessToken({ clientId: "other" });
    const response = await get("/me", token);

    expect(response.status).toBe(401);
  });

  it("accepts a token whose aud carries the client, whatever its azp", async () => {
    const idp = await twoClients();
    const { get } = await bootOidc(idp);

    const token = await idp.provider.createAccessToken({
      clientId: "other",
      claims: { aud: ["account", "alepha"] },
    });

    expect((await get("/me", token)).status).toBe(200);
  });

  it("refuses a token whose iss is not the discovered issuer", async () => {
    const idp = await twoClients();
    const { get } = await bootOidc(idp);

    const token = await idp.provider.createAccessToken({
      clientId: "alepha",
      claims: { iss: "https://elsewhere.example.com/realms/test" },
    });

    expect((await get("/me", token)).status).toBe(401);
  });

  it("signs in end to end, the cookie path verified the same way", async () => {
    const idp = await twoClients();
    const { hostname } = await bootOidc(idp);

    const cookies = new Map<string, string>();
    let url = `${hostname}/oauth/login?provider=keycloak&redirect_uri=/me`;
    let response: Response;
    for (;;) {
      response = await fetch(url, {
        redirect: "manual",
        headers: {
          cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        },
      });
      for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(";");
        const index = pair!.indexOf("=");
        cookies.set(pair!.slice(0, index), pair!.slice(index + 1));
      }
      if (response.status < 300 || response.status >= 400) {
        break;
      }
      url = new URL(response.headers.get("location")!, url).toString();
    }

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "user-1" });
  });

  it("boots with the IdP unreachable, refuses while discovery fails, and retries on the next request", async () => {
    // A port nothing listens on, that the IdP will take later.
    const probe = await MockOidcServer.start({ realm: "late" });
    const port = Number(new URL(probe.issuer).port);
    const issuer = probe.issuer;
    await probe.stop();

    const { get } = await bootOidc({ issuer });

    const early = await MockOidcServer.start({ realm: "other-realm" });
    const unverifiable = await early.provider.createAccessToken();
    expect((await get("/me", unverifiable)).status).toBe(401);

    const idp = await MockOidcServer.start({
      port,
      realm: "late",
      clients: [{ clientId: "alepha" }],
    });
    expect(idp.issuer).toBe(issuer);

    const token = await idp.provider.createAccessToken();
    expect((await get("/me", token)).status).toBe(200);
    expect(idp.calls.some((it) => it.endpoint === "discovery")).toBe(true);
  });

  it("does not read an IdP's client_id claim as a machine credential", async () => {
    const idp = await twoClients();
    const { get } = await bootOidc(idp);

    // RFC 9068 makes client_id a required claim of a JWT access token.
    const token = await idp.provider.createAccessToken({
      clientId: "alepha",
      claims: { client_id: "alepha", permission_scope: [] },
    });

    expect((await get("/session-only", token)).status).toBe(200);
  });
});

describe("$issuer({ jwks })", () => {
  const bootJwks = (
    idp: MockOidcServer,
    expect: { issuer?: string; audience?: string } = {},
    env: Record<string, any> = {},
  ) => {
    class App extends Routes {
      issuer = $issuer({
        name: "keycloak",
        jwks: () => `${idp.issuer}/protocol/openid-connect/certs`,
        ...expect,
      });
    }
    return start(App, env);
  };

  it("refuses another client's token once issuer and audience are set", async () => {
    const idp = await twoClients();
    const { get } = await bootJwks(idp, {
      issuer: idp.issuer,
      audience: "alepha",
    });

    const mine = await idp.provider.createAccessToken({ clientId: "alepha" });
    const theirs = await idp.provider.createAccessToken({ clientId: "other" });

    expect((await get("/me", mine)).status).toBe(200);
    expect((await get("/me", theirs)).status).toBe(401);
  });

  it("warns once at start when no issuer is expected", async () => {
    const idp = await twoClients();
    const alepha = Alepha.create({ env: { LOG_LEVEL: "warn" } }).with({
      provide: LogDestinationProvider,
      use: MemoryDestinationProvider,
    });
    class App {
      bare = $issuer({
        name: "bare",
        jwks: () => `${idp.issuer}/protocol/openid-connect/certs`,
      });
      pinned = $issuer({
        name: "pinned",
        jwks: () => `${idp.issuer}/protocol/openid-connect/certs`,
        issuer: idp.issuer,
      });
    }
    alepha.with(App);
    await alepha.start();

    const warnings = alepha
      .inject(MemoryDestinationProvider)
      .logs.filter(
        (it) =>
          it.level === "WARN" && it.message.includes("no expected issuer"),
      );
    expect(warnings.map((it) => it.message)).toEqual([
      expect.stringContaining("'bare'"),
    ]);
  });
});

describe("$issuer forms", () => {
  it("refuses more than one of secret, jwks and oidc", async () => {
    class App {
      issuer = $issuer({
        name: "both",
        secret: "a-secret",
        jwks: { keys: [] },
      } as any);
    }
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    expect(() => alepha.with(App)).toThrow(/one of secret, jwks or oidc/);
  });
});
