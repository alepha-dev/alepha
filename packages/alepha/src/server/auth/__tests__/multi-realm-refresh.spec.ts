import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import type { UserAccount } from "alepha/security";
import { $route, ServerProvider, UnauthorizedError } from "alepha/server";
import { describe, expect, it } from "vitest";

import { $auth } from "../primitives/$auth.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";

/**
 * Two realms each register a `credentials` provider. Looking a provider up by
 * name alone lands on the first realm's issuer, so a session on the second
 * realm used to die with its access token: the refresh ran against the wrong
 * realm, which knew nothing of the refresh token, and the cookie was deleted.
 *
 * The tokens cookie now carries the realm it was minted in, and every refresh
 * (the cookie path and the `/_auth/refresh` route) resolves through it.
 */
const ACCESS_TOKEN_SECONDS = 900;

const issuerFor = (name: string, now: () => number) =>
  ({
    name,
    createToken: async (user: UserAccount) => ({
      access_token: `access-${name}-${user.id}`,
      refresh_token: `refresh-${name}-${user.id}`,
      expires_in: ACCESS_TOKEN_SECONDS,
      issued_at: now(),
    }),
    // Each realm only knows the refresh tokens it minted itself, like a
    // session table scoped to the realm.
    refreshToken: async (refreshToken: string) => {
      if (!refreshToken.startsWith(`refresh-${name}-`)) {
        throw new UnauthorizedError("Invalid refresh token");
      }
      return {
        tokens: {
          access_token: `refreshed-${name}`,
          refresh_token: refreshToken,
          expires_in: ACCESS_TOKEN_SECONDS,
          issued_at: now(),
        },
      };
    },
    options: {},
  }) as any;

const account = async (realm: string, body: { username: string }) =>
  ({ id: `${realm}-${body.username}`, name: body.username }) as UserAccount;

class TwoRealmsApp {
  protected clock = $inject(DateTimeProvider);

  protected now = () => this.clock.now().unix();

  citizens = $auth({
    name: "credentials",
    issuer: issuerFor("citizens", this.now),
    credentials: {
      account: (body) => account("citizens", body),
    },
  });

  staff = $auth({
    name: "credentials",
    issuer: issuerFor("staff", this.now),
    credentials: {
      account: (body) => account("staff", body),
    },
  });

  echo = $route({
    path: "/echo-auth",
    handler: ({ headers }) => headers.authorization ?? "",
  });
}

describe("token refresh across realms", () => {
  const boot = async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(TwoRealmsApp);
    alepha.with(ServerAuthProvider);
    await alepha.start();

    const hostname = alepha.inject(ServerProvider).hostname;
    const clock = alepha.inject(DateTimeProvider);

    const tokensCookie = (response: Response) => {
      const header = response.headers
        .getSetCookie()
        .find((it) => it.startsWith("tokens="));
      return header?.split(";")[0];
    };

    const signIn = async (realm: string) => {
      const response = await fetch(
        `${hostname}/_auth/token?provider=credentials&realm=${realm}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: "agent", password: "secret" }),
        },
      );
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      const cookie = tokensCookie(response);
      expect(cookie).toBeDefined();
      return { body, cookie: cookie! };
    };

    const echoWith = async (cookie: string) => {
      const response = await fetch(`${hostname}/echo-auth`, {
        headers: { cookie },
      });
      return {
        authorization: await response.text(),
        cookie: tokensCookie(response),
      };
    };

    const pastAccessToken = () =>
      clock.travel([ACCESS_TOKEN_SECONDS + 60, "seconds"]);

    return { alepha, hostname, clock, signIn, echoWith, pastAccessToken };
  };

  it("keeps a session on the second realm alive past its access token", async () => {
    const { signIn, echoWith, pastAccessToken } = await boot();

    const login = await signIn("staff");
    expect(login.body.realm).toBe("staff");
    expect(login.body.access_token).toBe("access-staff-staff-agent");

    await pastAccessToken();

    const first = await echoWith(login.cookie);
    expect(first.authorization).toBe("Bearer refreshed-staff");
    // The refreshed cookie is written back, so the next request carries it.
    expect(first.cookie).toBeDefined();
  });

  it("keeps the realm in the refreshed cookie, so the second refresh lands on the same issuer", async () => {
    const { signIn, echoWith, pastAccessToken } = await boot();

    const login = await signIn("staff");

    await pastAccessToken();
    const first = await echoWith(login.cookie);
    expect(first.authorization).toBe("Bearer refreshed-staff");

    await pastAccessToken();
    const second = await echoWith(first.cookie!);
    expect(second.authorization).toBe("Bearer refreshed-staff");
  });

  it("still refreshes a session on the first realm", async () => {
    const { signIn, echoWith, pastAccessToken } = await boot();

    const login = await signIn("citizens");
    expect(login.body.realm).toBe("citizens");

    await pastAccessToken();

    const { authorization } = await echoWith(login.cookie);
    expect(authorization).toBe("Bearer refreshed-citizens");
  });

  it("resolves the realm on the refresh route and writes it into the tokens", async () => {
    const { hostname, signIn } = await boot();

    const login = await signIn("staff");

    const response = await fetch(
      `${hostname}/_auth/refresh?provider=credentials&realm=staff`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: login.body.refresh_token }),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.realm).toBe("staff");
    expect(body.access_token).toBe("refreshed-staff");
  });

  it("refuses the second realm's refresh token on the refresh route without a realm", async () => {
    const { hostname, signIn } = await boot();

    const login = await signIn("staff");

    // No realm: the lookup lands on the first realm, which does not know
    // this refresh token. That is the failure the cookie used to hit.
    const response = await fetch(
      `${hostname}/_auth/refresh?provider=credentials`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: login.body.refresh_token }),
      },
    );

    expect(response.ok).toBe(false);
  });
});
