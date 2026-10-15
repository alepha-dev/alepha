import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import type { UserAccount } from "alepha/security";
import { $route, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { $auth } from "../primitives/$auth.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";

const ACCESS_TOKEN_SECONDS = 900;

/**
 * An issuer whose refresh answers like Google's: a new access token, and no
 * `refresh_token` or `id_token` (RFC 6749 section 6 allows it).
 */
const issuer = (now: () => number) =>
  ({
    name: "users",
    createToken: async (user: UserAccount) => ({
      access_token: `access-${user.id}`,
      refresh_token: `refresh-${user.id}`,
      id_token: `id-${user.id}`,
      expires_in: ACCESS_TOKEN_SECONDS,
      issued_at: now(),
    }),
    refreshToken: async (refreshToken: string) => {
      if (refreshToken !== "refresh-agent") {
        throw new Error("unknown refresh token");
      }
      return {
        tokens: {
          access_token: `refreshed-${now()}`,
          expires_in: ACCESS_TOKEN_SECONDS,
          issued_at: now(),
        },
      };
    },
    options: {},
  }) as any;

class App {
  protected clock = $inject(DateTimeProvider);

  credentials = $auth({
    name: "credentials",
    issuer: issuer(() => this.clock.now().unix()),
    credentials: {
      account: async (body) =>
        ({ id: body.username, name: body.username }) as UserAccount,
    },
  });

  read = $route({
    path: "/echo-auth",
    handler: ({ headers }) => headers.authorization ?? "",
  });

  write = $route({
    method: "POST",
    path: "/echo-auth",
    handler: ({ headers }) => headers.authorization ?? "",
  });
}

const boot = async (corsOrigin?: string) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(App);
  alepha.with(ServerAuthProvider);
  if (corsOrigin) {
    alepha.store.set("alepha.server.cors.options" as any, {
      origin: corsOrigin,
    });
  }
  await alepha.start();

  const hostname = alepha.inject(ServerProvider).hostname;
  const clock = alepha.inject(DateTimeProvider);

  const tokensCookie = (response: Response) =>
    response.headers
      .getSetCookie()
      .find((it) => it.startsWith("app.tokens="))
      ?.split(";")[0];

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
    return tokensCookie(response)!;
  };

  const echo = async (
    method: "GET" | "POST",
    cookie: string,
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(`${hostname}/echo-auth`, {
      method,
      headers: { cookie, ...headers },
    });
    return {
      authorization: await response.text(),
      cookie: tokensCookie(response),
    };
  };

  return { alepha, hostname, clock, signIn, echo };
};

describe("cookie credentials on a write need the app's own origin", () => {
  it("refuses a same-site request, the sibling-subdomain hole", async () => {
    const { signIn, echo } = await boot();
    const cookie = await signIn();

    const result = await echo("POST", cookie, {
      "sec-fetch-site": "same-site",
      origin: "https://sibling.example.com",
    });

    expect(result.authorization).toBe("");
  });

  it("refuses a cross-site request", async () => {
    const { signIn, echo } = await boot();
    const cookie = await signIn();

    const result = await echo("POST", cookie, {
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example",
    });

    expect(result.authorization).toBe("");
  });

  it("accepts a same-origin request", async () => {
    const { hostname, signIn, echo } = await boot();
    const cookie = await signIn();

    const result = await echo("POST", cookie, {
      "sec-fetch-site": "same-origin",
      origin: new URL(hostname).origin,
    });

    expect(result.authorization).toBe("Bearer access-agent");
  });

  it("checks Origin when Sec-Fetch-Site is absent: this host passes, another does not", async () => {
    const { hostname, signIn, echo } = await boot();
    const cookie = await signIn();

    const own = await echo("POST", cookie, {
      origin: new URL(hostname).origin,
    });
    const other = await echo("POST", cookie, {
      origin: "https://evil.example",
    });

    expect(own.authorization).toBe("Bearer access-agent");
    expect(other.authorization).toBe("");
  });

  it("accepts an origin CORS lists explicitly", async () => {
    const { signIn, echo } = await boot("https://studio.example.com");
    const cookie = await signIn();

    const withoutFetchMetadata = await echo("POST", cookie, {
      origin: "https://studio.example.com",
    });
    const withFetchMetadata = await echo("POST", cookie, {
      "sec-fetch-site": "same-site",
      origin: "https://studio.example.com",
    });

    expect(withoutFetchMetadata.authorization).toBe("Bearer access-agent");
    expect(withFetchMetadata.authorization).toBe("Bearer access-agent");
  });

  it("does not trust the default wildcard CORS origin", async () => {
    const { signIn, echo } = await boot("*");
    const cookie = await signIn();

    const result = await echo("POST", cookie, {
      origin: "https://evil.example",
    });

    expect(result.authorization).toBe("");
  });

  it("converts the cookie as before when neither header is present", async () => {
    const { signIn, echo } = await boot();
    const cookie = await signIn();

    const result = await echo("POST", cookie);

    expect(result.authorization).toBe("Bearer access-agent");
  });

  it("never gates a safe method", async () => {
    const { signIn, echo } = await boot();
    const cookie = await signIn();

    const result = await echo("GET", cookie, {
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example",
    });

    expect(result.authorization).toBe("Bearer access-agent");
  });

  it("leaves an explicit Authorization untouched", async () => {
    const { signIn, echo } = await boot();
    const cookie = await signIn();

    const result = await echo("POST", cookie, {
      "sec-fetch-site": "cross-site",
      authorization: "Bearer explicit",
    });

    expect(result.authorization).toBe("Bearer explicit");
  });
});

describe("a refresh that omits refresh_token keeps the previous one", () => {
  it("survives a second expiry on the cookie path", async () => {
    const { clock, signIn, echo } = await boot();
    let cookie = await signIn();

    await clock.travel([ACCESS_TOKEN_SECONDS + 60, "seconds"]);
    const first = await echo("GET", cookie);
    expect(first.authorization).toMatch(/^Bearer refreshed-/);
    cookie = first.cookie!;

    // The refreshed cookie still holds the refresh token: without it, this
    // second expiry found nothing to refresh with and signed the user out.
    await clock.travel([ACCESS_TOKEN_SECONDS + 60, "seconds"]);
    const second = await echo("GET", cookie);
    expect(second.authorization).toMatch(/^Bearer refreshed-/);
    expect(second.authorization).not.toBe(first.authorization);
  });

  it("keeps refresh_token and id_token on /_auth/refresh", async () => {
    const { hostname, signIn } = await boot();
    const cookie = await signIn();

    const response = await fetch(
      `${hostname}/_auth/refresh?provider=credentials`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ refresh_token: "refresh-agent" }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.access_token).toMatch(/^refreshed-/);
    expect(body.refresh_token).toBe("refresh-agent");
    expect(body.id_token).toBe("id-agent");
  });
});
