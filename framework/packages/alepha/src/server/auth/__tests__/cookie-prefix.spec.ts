import { Alepha } from "alepha";
import type { UserAccount } from "alepha/security";
import { ServerProvider } from "alepha/server";
import { MockOidcServer } from "alepha/testing/oidc";
import { afterEach, describe, expect, it } from "vitest";

import { $auth } from "../primitives/$auth.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";

/**
 * In production, over https, the auth cookies carry `__Host-Http-`
 * (RFC 10017 section 6.1.3.2). Over plain http they keep the bare name: a
 * browser drops a prefixed cookie without `Secure`.
 */

const issuer = {
  name: "users",
  createToken: async (user: UserAccount) => ({
    access_token: `access-${user.id}`,
    refresh_token: `refresh-${user.id}`,
    expires_in: 900,
    // Far ahead: these specs read cookie names, never an expiry.
    issued_at: 4_000_000_000,
  }),
  options: {},
} as any;

const started: Alepha[] = [];

afterEach(async () => {
  for (const it of started.splice(0)) {
    await it.stop();
  }
});

const boot = async (idp: MockOidcServer) => {
  class App {
    credentials = $auth({
      name: "credentials",
      issuer,
      credentials: {
        account: async (body) =>
          ({ id: body.username, name: body.username }) as UserAccount,
      },
    });

    keycloak = $auth({
      name: "keycloak",
      oidc: { issuer: idp.issuer, clientId: "alepha" },
    });
  }

  // Production: `Secure` is on by default, as on a deployed app. Outside a
  // test the container is not stopped for us.
  const alepha = Alepha.create({
    env: {
      NODE_ENV: "production",
      APP_SECRET: "a-production-secret-of-thirty-two-chars",
      SERVER_PORT: 0,
      LOG_LEVEL: "error",
    },
  });
  alepha.with(App);
  alepha.with(ServerAuthProvider);
  await alepha.start();
  started.push(alepha);

  const hostname = alepha.inject(ServerProvider).hostname;
  const signIn = (https: boolean, cookie = "") =>
    fetch(`${hostname}/_auth/token?provider=credentials`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(https ? { "x-forwarded-proto": "https" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ username: "ada", password: "secret" }),
    });
  const login = (https: boolean) =>
    fetch(`${hostname}/oauth/login?provider=keycloak`, {
      redirect: "manual",
      headers: https ? { "x-forwarded-proto": "https" } : {},
    });

  return { signIn, login };
};

describe("auth cookies over https", () => {
  it("names the session __Host-Http-, with Secure and HttpOnly", async () => {
    const idp = await MockOidcServer.start();
    const { signIn } = await boot(idp);

    const response = await signIn(true);
    const tokens = response.headers
      .getSetCookie()
      .find((it) => it.includes(".tokens"));

    expect(tokens).toMatch(/^__Host-Http-app\.tokens=/);
    expect(tokens).toContain("Secure");
    expect(tokens).toContain("HttpOnly");
    expect(tokens).toContain("Path=/");
    expect(tokens).not.toContain("Domain=");
  });

  it("names the authorization-code cookie __Host-Http- too", async () => {
    const idp = await MockOidcServer.start();
    const { login } = await boot(idp);

    const response = await login(true);

    expect(response.status).toBe(302);
    expect(response.headers.getSetCookie()[0]).toMatch(
      /^__Host-Http-app\.authorizationCode=.*Secure/,
    );
  });

  it("keeps the bare name over plain http", async () => {
    const idp = await MockOidcServer.start();
    const { signIn } = await boot(idp);

    const response = await signIn(false);

    expect(response.headers.getSetCookie()[0]).toMatch(/^app\.tokens=/);
  });

  it("expires the unprefixed session a browser still holds from before", async () => {
    const idp = await MockOidcServer.start();
    const { signIn } = await boot(idp);

    const old = (await signIn(false)).headers.getSetCookie()[0]!.split(";")[0]!;
    const response = await signIn(true, old);
    const cookies = response.headers.getSetCookie();

    expect(cookies.some((it) => /^app\.tokens=;.*Max-Age=0/.test(it))).toBe(
      true,
    );
    expect(cookies.some((it) => it.startsWith("__Host-Http-app.tokens="))).toBe(
      true,
    );
  });
});
