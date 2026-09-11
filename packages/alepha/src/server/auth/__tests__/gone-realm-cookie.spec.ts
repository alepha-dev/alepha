import { $inject, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import type { UserAccount } from "alepha/security";
import { $route, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { $auth } from "../primitives/$auth.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";

/**
 * A `tokens` cookie outlives the code that minted it by up to 30 days, and it
 * names the realm it was minted in. #Q2264 renamed the default realm from
 * `default` to `users`, so on the deploy every signed-in browser came back
 * with a cookie naming a realm that no longer existed.
 *
 * The provider lookup behind that cookie threw a `SecurityError`, from the
 * request hook and outside any catch, so every request those browsers made
 * answered 403 - logout and userinfo included, which left no way out - until
 * the access token expired. Measured against the unfixed provider: all three
 * cases below went red with a 403. The owner accepted a one-time sign-out,
 * not a 403 on every page.
 */
const issuerFor = (name: string, now: () => number) =>
  ({
    name,
    createToken: async (user: UserAccount) => ({
      access_token: `access-${name}-${user.id}`,
      refresh_token: `refresh-${name}-${user.id}`,
      expires_in: 900,
      issued_at: now(),
    }),
    refreshToken: async () => {
      throw new AlephaError("not reached");
    },
    options: {},
  }) as any;

/**
 * One app, whose single realm goes by `realm`. Booting it twice under two
 * names is the rename, as the browser sees it.
 */
const appFor = (realm: string) =>
  class App {
    protected clock = $inject(DateTimeProvider);

    protected now = () => this.clock.now().unix();

    credentials = $auth({
      name: "credentials",
      issuer: issuerFor(realm, this.now),
      credentials: {
        account: async (body) =>
          ({ id: `u-${body.username}`, name: body.username }) as UserAccount,
      },
    });

    echo = $route({
      path: "/echo-auth",
      handler: ({ headers }) => headers.authorization ?? "",
    });
  };

const boot = async (realm: string) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(appFor(realm));
  alepha.with(ServerAuthProvider);
  await alepha.start();
  return { alepha, hostname: alepha.inject(ServerProvider).hostname };
};

const tokensCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((it) => it.startsWith("tokens="))
    ?.split(";")[0];

/**
 * Sign in on an app whose realm is `realm` and keep the cookie it set.
 */
const signIn = async (realm: string) => {
  const { alepha, hostname } = await boot(realm);
  const response = await fetch(
    `${hostname}/_auth/token?provider=credentials&realm=${realm}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "agent", password: "secret" }),
    },
  );
  const cookie = tokensCookie(response);
  await alepha.stop();
  if (response.status !== 200 || !cookie) {
    throw new AlephaError(`sign-in on '${realm}' failed: ${response.status}`);
  }
  return cookie;
};

describe("a tokens cookie whose realm is gone", () => {
  it("serves the request anonymous and clears the cookie", async ({
    expect,
  }) => {
    const cookie = await signIn("default");
    const { hostname } = await boot("users");

    const response = await fetch(`${hostname}/echo-auth`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    // No bearer: the cookie named nobody this app can verify.
    expect(await response.text()).toBe("");
    // Deleted, so the next request does not pay for it again.
    expect(tokensCookie(response)).toBe("tokens=");
  });

  it("can still log out", async ({ expect }) => {
    const cookie = await signIn("default");
    const { hostname } = await boot("users");

    const response = await fetch(`${hostname}/oauth/logout`, {
      method: "POST",
      headers: { cookie },
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(tokensCookie(response)).toBe("tokens=");
  });

  it("answers userinfo with no user", async ({ expect }) => {
    const cookie = await signIn("default");
    const { hostname } = await boot("users");

    const response = await fetch(`${hostname}/_auth/userinfo`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect((await response.json()).user).toBeUndefined();
  });

  it("keeps serving a cookie whose realm still exists", async ({ expect }) => {
    // The control: the same cookie shape, minted and read under one name.
    const cookie = await signIn("users");
    const { hostname } = await boot("users");

    const response = await fetch(`${hostname}/echo-auth`, {
      headers: { cookie },
    });

    expect(await response.text()).toBe("Bearer access-users-u-agent");
  });
});
