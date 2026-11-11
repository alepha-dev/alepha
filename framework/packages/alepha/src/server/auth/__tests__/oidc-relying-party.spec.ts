import { Alepha, z } from "alepha";
import { $issuer, $secure } from "alepha/security";
import { $route, ServerProvider } from "alepha/server";
import { MockOidcServer } from "alepha/testing/oidc";
import { describe, expect, it } from "vitest";

import { $auth } from "../primitives/$auth.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";

/**
 * `$auth({ oidc })` with no `issuer`: Alepha is the relying party, holds no
 * user table, and keeps the provider's own tokens in the session cookie.
 */

/**
 * A browser for one origin, enough of one to follow a sign-in: it keeps the
 * cookies each response sets and follows redirects by hand, so every hop is
 * visible.
 */
class Browser {
  public readonly jar = new Map<string, string>();

  public cookie(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  public async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: {
        cookie: this.cookie(),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";");
      const index = pair!.indexOf("=");
      const name = pair!.slice(0, index).trim();
      const value = pair!.slice(index + 1).trim();
      const expired = attributes.some((it) =>
        /^(max-age=0|expires=thu, 01 jan 1970)/i.test(it.trim()),
      );
      if (expired || value === "") {
        this.jar.delete(name);
      } else {
        this.jar.set(name, value);
      }
    }
    return response;
  }

  /**
   * Follow redirects until a non-3xx answer, returning every location seen.
   */
  public async follow(url: string, init: RequestInit = {}) {
    const visited: string[] = [];
    let response = await this.fetch(url, init);
    while (response.status >= 300 && response.status < 400) {
      const next = new URL(response.headers.get("location")!, url).toString();
      visited.push(next);
      url = next;
      response = await this.fetch(next);
    }
    return { response, visited };
  }
}

const boot = async (idp: MockOidcServer, other?: MockOidcServer) => {
  class App {
    issuer = $issuer({
      name: "keycloak",
      jwks: () => `${idp.issuer}/protocol/openid-connect/certs`,
    });

    keycloak = $auth({
      name: "keycloak",
      oidc: { issuer: idp.issuer, clientId: "alepha" },
    });

    partner = other
      ? $auth({
          name: "partner",
          oidc: { issuer: other.issuer, clientId: "second" },
        })
      : undefined;

    me = $route({
      path: "/me",
      use: [$secure()],
      schema: {
        response: z.object({ id: z.text(), name: z.text() }),
      },
      handler: ({ user }) => ({ id: user!.id, name: user!.name ?? "" }),
    });
  }

  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(App);
  alepha.with(ServerAuthProvider);
  await alepha.start();

  const hostname = alepha.inject(ServerProvider).hostname;
  const browser = new Browser();

  const signIn = async (provider = "keycloak") => {
    const { response, visited } = await browser.follow(
      `${hostname}/oauth/login?provider=${provider}&redirect_uri=/me`,
    );
    return { response, visited };
  };

  return { alepha, hostname, browser, signIn };
};

describe("$auth({ oidc }) without an issuer", () => {
  it("signs in with PKCE and answers a $secure route with no user table", async () => {
    const idp = await MockOidcServer.start();
    const { hostname, browser, signIn } = await boot(idp);

    const login = await browser.fetch(
      `${hostname}/oauth/login?provider=keycloak`,
    );
    expect(login.status).toBe(302);
    const authorize = new URL(login.headers.get("location")!);
    expect(authorize.origin + authorize.pathname).toBe(
      `${idp.issuer}/protocol/openid-connect/auth`,
    );
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("code_challenge")).toBeTruthy();
    expect(authorize.searchParams.get("client_id")).toBe("alepha");

    browser.jar.clear();
    const { response, visited } = await signIn();

    expect(visited[visited.length - 2]).toContain("/oauth/callback?code=");
    expect(visited[visited.length - 1]).toBe(`${hostname}/me`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "user-1",
      name: "Ada Lovelace",
    });

    // The session is the provider's own tokens, encrypted: nothing of them
    // reads in the clear.
    const cookie = browser.jar.get("app.tokens")!;
    expect(cookie).toBeTruthy();
    expect(cookie).not.toContain("eyJ");
    expect(browser.jar.has("app.authorizationCode")).toBe(false);
    expect(
      idp.calls
        .filter((it) => it.endpoint === "token")
        .map((it) => it.grantType),
    ).toEqual(["authorization_code"]);
  });

  it("answers 401 to the $secure route without a session", async () => {
    const idp = await MockOidcServer.start();
    const { hostname } = await boot(idp);

    const response = await fetch(`${hostname}/me`);
    expect(response.status).toBe(401);
  });

  it("refreshes an expired access token before the request runs", async () => {
    const idp = await MockOidcServer.start();
    const { hostname, browser, signIn } = await boot(idp);

    await signIn();
    const before = browser.jar.get("app.tokens");

    // Under the refresh grace period (10 seconds): every request finds the
    // access token expired.
    idp.configure({ accessTokenTtl: 5 });
    await signIn();
    const signedIn = browser.jar.get("app.tokens");
    expect(signedIn).not.toBe(before);

    const response = await browser.fetch(`${hostname}/me`);
    expect(response.status).toBe(200);
    expect(browser.jar.get("app.tokens")).not.toBe(signedIn);
    expect(
      idp.calls.filter((it) => it.grantType === "refresh_token"),
    ).not.toHaveLength(0);
  });

  it("signs out when the provider refuses the refresh", async () => {
    const idp = await MockOidcServer.start();
    const { hostname, browser, signIn } = await boot(idp);

    idp.configure({ accessTokenTtl: 5, refreshTokenTtl: -1 });
    await signIn();

    const response = await browser.fetch(`${hostname}/me`);
    expect(response.status).toBe(401);
    expect(browser.jar.has("app.tokens")).toBe(false);
  });

  it("logs out at the provider's end-session endpoint with id_token_hint", async () => {
    const idp = await MockOidcServer.start();
    const { hostname, browser, signIn } = await boot(idp);
    await signIn();

    const logout = await browser.fetch(
      `${hostname}/oauth/logout?post_logout_redirect_uri=/bye`,
      { method: "POST", headers: { origin: hostname } },
    );

    expect(logout.status).toBe(302);
    const target = new URL(logout.headers.get("location")!);
    expect(target.origin + target.pathname).toBe(
      `${idp.issuer}/protocol/openid-connect/logout`,
    );
    // Absolute: the provider redirects the browser, and a relative URL
    // would resolve against the provider's own origin.
    expect(target.searchParams.get("post_logout_redirect_uri")).toBe(
      `${hostname}/bye`,
    );
    const hint = target.searchParams.get("id_token_hint")!;
    const payload = JSON.parse(
      Buffer.from(hint.split(".")[1]!, "base64url").toString("utf8"),
    );
    expect(payload).toMatchObject({ iss: idp.issuer, aud: "alepha" });
    expect(browser.jar.has("app.tokens")).toBe(false);

    const after = await browser.fetch(`${hostname}/me`);
    expect(after.status).toBe(401);
  });

  it("serves two providers at once, each looked up by its name", async () => {
    const idp = await MockOidcServer.start({
      clients: [{ clientId: "alepha" }],
    });
    const other = await MockOidcServer.start({
      realm: "other",
      clients: [{ clientId: "second" }],
      user: { sub: "user-2", name: "Grace Hopper" },
    });

    const { hostname, browser } = await boot(idp, other);

    const first = await browser.fetch(
      `${hostname}/oauth/login?provider=keycloak`,
    );
    expect(first.headers.get("location")).toContain(idp.issuer);

    const second = await browser.fetch(
      `${hostname}/oauth/login?provider=partner`,
    );
    const location = new URL(second.headers.get("location")!);
    expect(location.toString()).toContain(other.issuer);
    expect(location.searchParams.get("client_id")).toBe("second");

    browser.jar.clear();
    await browser.follow(`${hostname}/oauth/login?provider=partner`);
    expect(browser.jar.has("app.tokens")).toBe(true);
    expect(idp.calls.some((it) => it.endpoint === "token")).toBe(false);
    expect(other.calls.find((it) => it.endpoint === "token")?.clientId).toBe(
      "second",
    );
  });
});
