import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $issuer, $secure } from "alepha/security";
import { $route, ServerProvider } from "alepha/server";
import { type MockOidcOptions, MockOidcServer } from "alepha/testing/oidc";
import { describe, expect, it } from "vitest";

import { $auth, type OidcOptions } from "../primitives/$auth.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";
import { BackchannelLogoutRegistry } from "../services/BackchannelLogoutRegistry.ts";

/**
 * Logout reaches the identity provider: the session's refresh token is
 * revoked (RFC 7009) on every logout path, and a session the provider ends
 * on its side is signed out here (OpenID Connect Back-Channel Logout 1.0).
 */

class Browser {
  public readonly jar = new Map<string, string>();

  public async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: {
        cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";");
      const index = pair!.indexOf("=");
      const name = pair!.slice(0, index).trim();
      const value = pair!.slice(index + 1).trim();
      if (value === "" || attributes.some((it) => /max-age=0/i.test(it))) {
        this.jar.delete(name);
      } else {
        this.jar.set(name, value);
      }
    }
    return response;
  }

  public async follow(url: string): Promise<Response> {
    let response = await this.fetch(url);
    while (response.status >= 300 && response.status < 400) {
      url = new URL(response.headers.get("location")!, url).toString();
      response = await this.fetch(url);
    }
    return response;
  }
}

const boot = async (
  idpOptions: MockOidcOptions = {},
  oidc: Partial<OidcOptions> = { backchannelLogout: true },
) => {
  const idp = await MockOidcServer.start(idpOptions);

  class App {
    keycloak = $auth({
      oidc: { issuer: idp.issuer, clientId: "alepha", ...oidc },
    });
    issuer = $issuer({ name: "keycloak", oidc: () => this.keycloak });
    me = $route({
      path: "/me",
      use: [$secure()],
      schema: { response: z.object({ id: z.text() }) },
      handler: ({ user }) => ({ id: user!.id }),
    });
  }

  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(App);
  alepha.with(ServerAuthProvider);
  await alepha.start();

  const hostname = alepha.inject(ServerProvider).hostname;
  const browser = new Browser();
  const signIn = () =>
    browser.follow(
      `${hostname}/oauth/login?provider=keycloak&redirect_uri=/me`,
    );
  const me = () => browser.fetch(`${hostname}/me`);
  const logout = () =>
    browser.fetch(`${hostname}/oauth/logout`, {
      method: "POST",
      headers: { origin: hostname },
    });
  const backchannel = (
    options: Parameters<MockOidcServer["backchannelLogout"]>[1],
  ) =>
    idp.backchannelLogout(
      `${hostname}/oauth/backchannel-logout?provider=keycloak`,
      options,
    );

  return { alepha, idp, hostname, browser, signIn, me, logout, backchannel };
};

const refreshTokenOf = (idp: MockOidcServer) =>
  idp.calls.filter((it) => it.endpoint === "revocation").map((it) => it.token);

describe("logout revokes at the identity provider", () => {
  it("revokes the refresh token before redirecting to end-session", async () => {
    const { idp, signIn, logout } = await boot();
    expect((await signIn()).status).toBe(200);

    const response = await logout();

    expect(response.headers.get("location")).toContain(
      "/openid-connect/logout",
    );
    const revoked = idp.calls.find((it) => it.endpoint === "revocation");
    expect(revoked?.tokenTypeHint).toBe("refresh_token");
    expect(idp.provider.isRevoked(revoked!.token!)).toBe(true);
  });

  it("revokes when the provider advertises no end-session endpoint", async () => {
    const { idp, signIn, logout } = await boot({
      advertise: { endSession: false },
    });
    await signIn();

    const response = await logout();

    expect(response.headers.get("location")).toBe("/");
    expect(refreshTokenOf(idp)).toHaveLength(1);
  });

  it("revokes when a custom logoutUri replaces the endpoint", async () => {
    const { idp, signIn, logout } = await boot(
      {},
      { logoutUri: "https://idp.example.com/bye" },
    );
    await signIn();

    const response = await logout();

    expect(response.headers.get("location")).toMatch(
      /^https:\/\/idp\.example\.com\/bye\?/,
    );
    expect(refreshTokenOf(idp)).toHaveLength(1);
  });

  it("calls nothing when the provider advertises no revocation", async () => {
    const { idp, signIn, logout } = await boot({
      advertise: { revocation: false },
    });
    await signIn();

    expect((await logout()).status).toBe(302);
    expect(refreshTokenOf(idp)).toHaveLength(0);
  });
});

describe("back-channel logout", () => {
  it("signs out the session a logout token names by sid, before any refresh", async () => {
    const { idp, signIn, me, browser, backchannel } = await boot();
    await signIn();
    expect((await me()).status).toBe(200);
    const [sid] = idp.provider.sessions();

    const response = await backchannel({ sid });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    // An expired access token would be refreshed: the check runs first.
    idp.configure({ accessTokenTtl: 5 });
    const refreshes = idp.calls.filter(
      (it) => it.grantType === "refresh_token",
    ).length;

    expect((await me()).status).toBe(401);
    expect(browser.jar.size).toBe(0);
    expect(
      idp.calls.filter((it) => it.grantType === "refresh_token"),
    ).toHaveLength(refreshes);
  });

  it("signs out every session of a subject by sub, and a later sign-in passes", async () => {
    const { alepha, signIn, me, backchannel } = await boot();
    await signIn();

    expect((await backchannel({ sub: "user-1" })).status).toBe(200);
    expect((await me()).status).toBe(401);

    await alepha.inject(DateTimeProvider).travel(2, "seconds");
    expect((await signIn()).status).toBe(200);
    expect((await me()).status).toBe(200);
  });

  it("leaves another session of the subject alone on a logout by sid", async () => {
    const { idp, signIn, me, backchannel } = await boot();
    await signIn();
    const [sid] = idp.provider.sessions();
    await signIn();

    expect((await backchannel({ sid })).status).toBe(200);
    expect((await me()).status).toBe(200);
  });

  it("refuses an invalid logout token with 400", async () => {
    const { idp, hostname, backchannel } = await boot({
      clients: [{ clientId: "alepha" }, { clientId: "other" }],
    });
    const post = (logout_token: string) =>
      fetch(`${hostname}/oauth/backchannel-logout?provider=keycloak`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ logout_token }).toString(),
      });

    expect((await backchannel({ sid: "s", clientId: "other" })).status).toBe(
      400,
    );
    expect(
      (await backchannel({ sid: "s", claims: { nonce: "n" } })).status,
    ).toBe(400);
    expect(
      (await backchannel({ sid: "s", claims: { events: {} } })).status,
    ).toBe(400);
    expect((await backchannel({ claims: {} })).status).toBe(400);
    expect(
      (await backchannel({ sid: "s", claims: { iss: "https://elsewhere" } }))
        .status,
    ).toBe(400);
    expect((await post("not-a-jwt")).status).toBe(400);
    expect((await post(await idp.provider.createAccessToken())).status).toBe(
      400,
    );
  });

  it("answers 404 and declares no cache for a provider that did not opt in", async () => {
    const { alepha, backchannel } = await boot({}, {});

    expect((await backchannel({ sid: "s" })).status).toBe(404);
    expect(alepha.has(BackchannelLogoutRegistry)).toBe(false);
  });
});
