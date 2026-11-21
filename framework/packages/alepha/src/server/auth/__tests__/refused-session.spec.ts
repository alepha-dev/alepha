import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $issuer, $secure, type UserAccount } from "alepha/security";
import { $route, ServerProvider } from "alepha/server";
import { type MockOidcOptions, MockOidcServer } from "alepha/testing/oidc";
import { describe, it } from "vitest";

import { BrowserJar } from "../../cookies/__tests__/BrowserJar.ts";
import { serverAuthOptions } from "../atoms/serverAuthOptions.ts";
import { $auth, type OidcOptions } from "../primitives/$auth.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";

/**
 * A route that reads the session after the request hook must see what the
 * hook left of it: a session the hook refused is gone, and one it refreshed
 * holds the new tokens. The provider here has no `issuer`, so the session is
 * the identity provider's own tokens in the cookie, with nothing server side.
 */

/**
 * A realm for a second, `credentials` provider beside the OIDC one. Its
 * refresh answers no `id_token`, so the refresh route carries over the one
 * the session holds.
 */
const realm = {
  name: "users",
  createToken: async (user: UserAccount) => ({
    access_token: `access-${user.id}`,
    refresh_token: `refresh-${user.id}`,
    id_token: `id-${user.id}`,
    expires_in: 900,
    issued_at: 4_000_000_000,
  }),
  refreshToken: async () => ({
    tokens: {
      access_token: "refreshed",
      expires_in: 900,
      issued_at: 4_000_000_000,
    },
  }),
  options: {},
} as any;

const boot = async (
  idpOptions: MockOidcOptions = {},
  oidc: Partial<OidcOptions> = {},
  sessionStore = false,
) => {
  const idp = await MockOidcServer.start(idpOptions);

  class App {
    keycloak = $auth({
      oidc: { issuer: idp.issuer, clientId: "alepha", ...oidc },
    });
    credentials = $auth({
      name: "credentials",
      issuer: realm,
      credentials: {
        account: async (body) =>
          ({ id: body.username, name: body.username }) as UserAccount,
      },
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
  alepha.store.set(serverAuthOptions, { sessionStore });
  alepha.with(App);
  alepha.with(ServerAuthProvider);
  await alepha.start();

  const hostname = alepha.inject(ServerProvider).hostname;
  const jar = new BrowserJar();

  const request = async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: {
        cookie: jar.header,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    jar.apply(response.headers.getSetCookie());
    return response;
  };

  /**
   * Sign in, stopping before the redirect back to the app: the next request
   * is the first the app sees with the session cookie.
   */
  const signIn = async () => {
    let url = `${hostname}/oauth/login?provider=keycloak&redirect_uri=/me`;
    for (;;) {
      const response = await request(url);
      const location = response.headers.get("location");
      if (!location) {
        return;
      }
      url = new URL(location, url).toString();
      if (new URL(url).pathname === "/me") {
        return;
      }
    }
  };

  /**
   * With a copied cookie: nothing of the answer reaches the jar, as for
   * someone replaying a value taken from the browser.
   */
  const replay = (path: string, cookie: string, headers = {}) =>
    fetch(`${hostname}${path}`, { headers: { cookie, ...headers } });

  const userinfo = async (cookie: string, headers = {}) =>
    (await (await replay("/_auth/userinfo", cookie, headers)).json()) as {
      user?: { id: string };
    };

  const logout = () =>
    request(`${hostname}/oauth/logout`, {
      method: "POST",
      headers: { origin: hostname },
    });

  const endAtProvider = async () => {
    const [sid] = idp.provider.sessions();
    return idp.backchannelLogout(
      `${hostname}/oauth/backchannel-logout?provider=keycloak`,
      { sid },
    );
  };

  /**
   * A `POST` with a copied cookie, the jar left alone.
   */
  const post = (path: string, cookie: string, init: RequestInit = {}) =>
    fetch(`${hostname}${path}`, {
      ...init,
      method: "POST",
      redirect: "manual",
      headers: {
        cookie,
        ...(init.headers as Record<string, string> | undefined),
      },
    });

  const refreshCredentials = async (cookie: string, headers = {}) =>
    post("/_auth/refresh?provider=credentials", cookie, {
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ refresh_token: "refresh-mallory" }),
    });

  return {
    alepha,
    idp,
    hostname,
    jar,
    request,
    signIn,
    replay,
    userinfo,
    logout,
    endAtProvider,
    post,
    refreshCredentials,
  };
};

/**
 * What the identity provider was asked since `from`, token grants aside.
 */
const sentToProvider = (idp: MockOidcServer, from: number) =>
  idp.calls
    .slice(from)
    .map((it) => it.endpoint)
    .filter((it) => it === "endSession" || it === "revocation");

/**
 * A request with its own `Authorization`: the request hook leaves the cookie
 * alone, so the route is the only reader of the session.
 */
const OWN_AUTHORIZATION = { authorization: "Basic eDp5" };

describe("/_auth/userinfo on a session the request hook refused", () => {
  it("answers the user of a live session", async ({ expect }) => {
    const { jar, signIn, replay, userinfo } = await boot();
    await signIn();

    expect((await replay("/me", jar.header)).status).toBe(200);
    expect((await userinfo(jar.header)).user?.id).toBe("user-1");
  });

  it("answers no user once the access token expired and the refresh is refused", async ({
    expect,
  }) => {
    const { idp, jar, signIn, replay, userinfo } = await boot();
    idp.configure({ accessTokenTtl: 5, refreshTokenTtl: -1 });
    await signIn();
    const cookie = jar.header;

    expect((await replay("/me", cookie)).status).toBe(401);
    expect((await userinfo(cookie)).user).toBeUndefined();
    expect((await userinfo(cookie)).user).toBeUndefined();
  });

  it("answers no user once a back-channel logout ended the session, replays included", async ({
    expect,
  }) => {
    const { idp, hostname, jar, signIn, replay, userinfo } = await boot(
      {},
      { backchannelLogout: true },
    );
    await signIn();
    const cookie = jar.header;
    expect((await userinfo(cookie)).user?.id).toBe("user-1");

    const [sid] = idp.provider.sessions();
    const ended = await idp.backchannelLogout(
      `${hostname}/oauth/backchannel-logout?provider=keycloak`,
      { sid },
    );
    expect(ended.status).toBe(200);

    expect((await replay("/me", cookie)).status).toBe(401);
    expect((await userinfo(cookie)).user).toBeUndefined();
    expect((await userinfo(cookie)).user).toBeUndefined();
  });

  it("answers no user for an ended session sent beside an Authorization header, which skips the hook's cookie read", async ({
    expect,
  }) => {
    const { idp, hostname, jar, signIn, userinfo } = await boot(
      {},
      { backchannelLogout: true },
    );
    await signIn();
    const cookie = jar.header;
    const [sid] = idp.provider.sessions();
    await idp.backchannelLogout(
      `${hostname}/oauth/backchannel-logout?provider=keycloak`,
      { sid },
    );

    const answer = await userinfo(cookie, { authorization: "Basic eDp5" });

    expect(answer.user).toBeUndefined();
  });

  it("reads the session the hook refreshed, with one refresh grant, when the provider rotates refresh tokens", async ({
    expect,
  }) => {
    const { alepha, idp, hostname, jar, signIn, userinfo } = await boot({
      rotateRefreshTokens: true,
      accessTokenTtl: 300,
    });
    await signIn();
    // Past the access token, by the app's clock alone: the hook refreshes,
    // and the token it gets is expired too for this app, so the route's
    // fallback runs and reads the session a second time.
    await alepha.inject(DateTimeProvider).travel(600, "seconds");

    const response = await fetch(`${hostname}/_auth/userinfo`, {
      headers: { cookie: jar.header },
    });
    jar.apply(response.headers.getSetCookie());

    expect(((await response.json()) as any).user?.id).toBe("user-1");
    // One refresh, not a second one with the token the first retired.
    expect(
      idp.calls.filter((it) => it.grantType === "refresh_token"),
    ).toHaveLength(1);
    expect((await userinfo(jar.header)).user?.id).toBe("user-1");
  });
});

describe("logout of a session the request hook just refreshed", () => {
  it("revokes the refresh token the session holds now, not the one the request carried", async ({
    expect,
  }) => {
    const { alepha, idp, jar, signIn, logout } = await boot({
      rotateRefreshTokens: true,
      accessTokenTtl: 300,
    });
    await signIn();
    expect(idp.provider.sessions()).toHaveLength(1);
    await alepha.inject(DateTimeProvider).travel(600, "seconds");

    const response = await logout();

    expect(response.status).toBe(302);
    expect(
      idp.calls.filter((it) => it.grantType === "refresh_token"),
    ).toHaveLength(1);
    // The grant the refresh minted during the logout is the live one.
    expect(idp.provider.sessions()).toHaveLength(0);
    expect(jar.names).toEqual([]);
  });

  it("appends its parameters to a custom logoutUri that already has a query", async ({
    expect,
  }) => {
    const { signIn, logout } = await boot(
      {},
      { logoutUri: "https://idp.example.com/v2/logout?client_id=alepha" },
    );
    await signIn();

    const response = await logout();

    const target = new URL(response.headers.get("location")!);
    expect(target.origin + target.pathname).toBe(
      "https://idp.example.com/v2/logout",
    );
    expect(target.searchParams.get("client_id")).toBe("alepha");
    expect(target.searchParams.get("post_logout_redirect_uri")).toMatch(
      /^http:\/\/localhost:\d+\/$/,
    );
    expect(target.searchParams.get("id_token_hint")).toMatch(/^eyJ/);
  });
});

describe.each([
  ["stateless", false],
  ["with the session store", true],
])("logout of a dead session (%s)", (_mode, sessionStore) => {
  it("ends locally a session a back-channel logout ended, and sends none of it to the provider", async ({
    expect,
  }) => {
    const { idp, jar, signIn, endAtProvider, post } = await boot(
      {},
      { backchannelLogout: true },
      sessionStore,
    );
    await signIn();
    const cookie = jar.header;
    await endAtProvider();
    const from = idp.calls.length;

    const response = await post("/oauth/logout", cookie, {
      headers: OWN_AUTHORIZATION,
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(sentToProvider(idp, from)).toEqual([]);
    expect(response.headers.getSetCookie().join("\n")).toMatch(
      /app\.tokens=; Path=\/; Max-Age=0/,
    );
  });

  it("ends locally a session expired past its refresh", async ({ expect }) => {
    const { idp, jar, signIn, post } = await boot({}, {}, sessionStore);
    idp.configure({ accessTokenTtl: 5, refreshTokenTtl: -1 });
    await signIn();
    const from = idp.calls.length;

    const response = await post("/oauth/logout", jar.header, {
      headers: OWN_AUTHORIZATION,
    });

    expect(response.headers.get("location")).toBe("/");
    expect(sentToProvider(idp, from)).toEqual([]);
  });

  it("ends locally a dead session posted from another origin", async ({
    expect,
  }) => {
    const { idp, jar, signIn, endAtProvider, post } = await boot(
      {},
      { backchannelLogout: true },
      sessionStore,
    );
    await signIn();
    const cookie = jar.header;
    await endAtProvider();
    const from = idp.calls.length;

    const response = await post("/oauth/logout", cookie, {
      headers: { origin: "https://elsewhere.example" },
    });

    expect(response.headers.get("location")).toBe("/");
    expect(sentToProvider(idp, from)).toEqual([]);
  });

  it("still ends a live session at the provider, with its id_token_hint", async ({
    expect,
  }) => {
    const { idp, jar, signIn, post } = await boot({}, {}, sessionStore);
    await signIn();
    const from = idp.calls.length;

    const response = await post("/oauth/logout", jar.header, {
      headers: OWN_AUTHORIZATION,
    });

    const target = new URL(response.headers.get("location")!);
    expect(target.pathname).toContain("/openid-connect/logout");
    expect(target.searchParams.get("id_token_hint")).toMatch(/^eyJ/);
    expect(sentToProvider(idp, from)).toEqual(["revocation"]);
  });
});

describe.each([
  ["stateless", false],
  ["with the session store", true],
])(
  "/_auth/refresh beside another provider's session (%s)",
  (_mode, sessionStore) => {
    it("carries nothing over from a session a back-channel logout ended", async ({
      expect,
    }) => {
      const { jar, signIn, endAtProvider, refreshCredentials, replay } =
        await boot({}, { backchannelLogout: true }, sessionStore);
      await signIn();
      const cookie = jar.header;
      await endAtProvider();

      const response = await refreshCredentials(cookie, OWN_AUTHORIZATION);

      expect(response.status).toBe(200);
      expect(((await response.json()) as any).id_token).toBeUndefined();
      // The dead session's cookie did not come back to life.
      expect((await replay("/me", cookie)).status).toBe(401);
    });

    it("carries nothing over from a live session of another provider", async ({
      expect,
    }) => {
      const { jar, signIn, refreshCredentials } = await boot(
        {},
        {},
        sessionStore,
      );
      await signIn();

      const response = await refreshCredentials(jar.header, OWN_AUTHORIZATION);

      expect(response.status).toBe(200);
      expect(((await response.json()) as any).id_token).toBeUndefined();
    });

    it("keeps the id_token of the provider's own session when the refresh answers none", async ({
      expect,
    }) => {
      const { hostname, jar, request, refreshCredentials } = await boot(
        {},
        {},
        sessionStore,
      );
      const signedIn = await request(
        `${hostname}/_auth/token?provider=credentials`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: "mallory", password: "secret" }),
        },
      );
      expect(signedIn.status).toBe(200);

      const response = await refreshCredentials(jar.header, {
        origin: hostname,
      });

      expect(response.status).toBe(200);
      expect(((await response.json()) as any).id_token).toBe("id-mallory");
    });
  },
);
