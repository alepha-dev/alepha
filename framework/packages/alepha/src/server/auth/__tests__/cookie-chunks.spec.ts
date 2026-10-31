import { randomBytes } from "node:crypto";

import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import type { UserAccount } from "alepha/security";
import { $route, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { BrowserJar } from "../../cookies/__tests__/BrowserJar.ts";
import { $auth } from "../primitives/$auth.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";

const ACCESS_TOKEN_SECONDS = 900;

/**
 * A signature's worth of random bytes per kilobyte, like a Keycloak JWT: deflate
 * gets nothing out of it.
 */
const token = (kilobytes: number) =>
  randomBytes(kilobytes * 750).toString("base64url");

/**
 * An issuer whose tokens pass 4 KB once compressed, encrypted and encoded, and
 * whose refresh answers with a far smaller set.
 */
const issuer = (accessToken: string, now: () => number) =>
  ({
    name: "users",
    createToken: async () => ({
      access_token: accessToken,
      refresh_token: token(3),
      id_token: token(3),
      expires_in: ACCESS_TOKEN_SECONDS,
      issued_at: now(),
    }),
    refreshToken: async () => ({
      tokens: {
        access_token: "refreshed",
        expires_in: ACCESS_TOKEN_SECONDS,
        issued_at: now(),
      },
    }),
    options: {},
  }) as any;

const boot = async () => {
  const accessToken = token(3);

  class App {
    protected clock = $inject(DateTimeProvider);

    credentials = $auth({
      name: "credentials",
      issuer: issuer(accessToken, () => this.clock.now().unix()),
      credentials: {
        account: async (body) =>
          ({ id: body.username, name: body.username }) as UserAccount,
      },
    });

    read = $route({
      path: "/echo-auth",
      handler: ({ headers }) => headers.authorization ?? "",
    });
  }

  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(App);
  alepha.with(ServerAuthProvider);
  await alepha.start();

  const hostname = alepha.inject(ServerProvider).hostname;
  const jar = new BrowserJar();

  const signIn = async () => {
    const response = await fetch(
      `${hostname}/_auth/token?provider=credentials`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "agent", password: "secret" }),
      },
    );
    expect(response.status).toBe(200);
    jar.apply(response.headers.getSetCookie());
  };

  const whoAmI = async () => {
    const response = await fetch(`${hostname}/echo-auth`, {
      headers: { cookie: jar.header },
    });
    jar.apply(response.headers.getSetCookie());
    return response.text();
  };

  const signOut = async () => {
    const response = await fetch(`${hostname}/oauth/logout`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: jar.header },
    });
    jar.apply(response.headers.getSetCookie());
  };

  return { accessToken, alepha, jar, signIn, signOut, whoAmI };
};

describe("a session whose tokens pass 4 KB", () => {
  it("keeps the session across a second request", async () => {
    const { accessToken, jar, signIn, whoAmI } = await boot();

    await signIn();

    expect(jar.names.length).toBeGreaterThan(1);
    expect(jar.names.every((name) => /^app\.tokens\.\d$/.test(name))).toBe(
      true,
    );
    expect(await whoAmI()).toBe(`Bearer ${accessToken}`);
  });

  it("reaches a WebSocket upgrade, which only has the raw Cookie header", async () => {
    const { accessToken, alepha, jar, signIn } = await boot();

    await signIn();

    await expect(
      alepha.inject(ServerAuthProvider).accessTokenFromCookieHeader(jar.header),
    ).resolves.toBe(accessToken);
  });

  it("leaves no stale chunk when a refresh shrinks the tokens", async () => {
    const { alepha, jar, signIn, whoAmI } = await boot();
    await signIn();
    const signedInChunks = jar.names.length;
    expect(signedInChunks).toBeGreaterThan(1);

    await alepha
      .inject(DateTimeProvider)
      .travel(ACCESS_TOKEN_SECONDS + 1, "seconds");

    expect(await whoAmI()).toBe("Bearer refreshed");
    expect(jar.names.length).toBeLessThan(signedInChunks);
    expect(await whoAmI()).toBe("Bearer refreshed");
  });

  it("signs out of every chunk", async () => {
    const { jar, signIn, signOut, whoAmI } = await boot();
    await signIn();

    await signOut();

    expect(jar.names).toEqual([]);
    expect(await whoAmI()).toBe("");
  });
});
