import { Alepha } from "alepha";
import type { UserAccount } from "alepha/security";
import { ServerProvider } from "alepha/server";
import { MockOidcServer } from "alepha/testing/oidc";
import { describe, it } from "vitest";

import { $auth } from "../primitives/$auth.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";

/**
 * GitHub sends `iss=https://github.com/login/oauth` on its authorization
 * callback (RFC 9207), and a callback whose `iss` differs from the provider's
 * issuer is refused. A manual `oauth` provider's issuer defaulted to its
 * authorization URL, which matches no `iss`, so every GitHub sign-in answered
 * 403 (#Q3761).
 */

const GITHUB_ISS = "https://github.com/login/oauth";

const issuer = {
  name: "test-realm",
  createToken: async (user: UserAccount) => ({
    access_token: `access-${user.id}`,
    refresh_token: `refresh-${user.id}`,
    expires_in: 3600,
  }),
  options: {},
} as any;

/**
 * Sign in through a provider that sends GitHub's `iss`, following every
 * redirect by hand with a cookie jar, and stop at the app's `/done` or at the
 * first answer that is not a redirect.
 */
const signIn = async (oauthIssuer: string | undefined) => {
  const idp = await MockOidcServer.start({ callbackIss: GITHUB_ISS });
  const base = `${idp.issuer}/protocol/openid-connect`;

  class App {
    github = $auth({
      name: "github",
      issuer,
      oauth: {
        clientId: "alepha",
        authorization: `${base}/auth`,
        token: `${base}/token`,
        clientSecret: "",
        scope: "read:user user:email",
        issuer: oauthIssuer,
        userinfo: async () => ({ sub: "gh-1", email: "ada@example.com" }),
        account: async () => ({ id: "user-1" }) as UserAccount,
      },
    });
  }

  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(App);
  alepha.with(ServerAuthProvider);
  await alepha.start();
  const hostname = alepha.inject(ServerProvider).hostname;

  const jar = new Map<string, string>();
  let url = `${hostname}/oauth/login?provider=github&redirect_uri=/done`;
  try {
    for (;;) {
      const response = await fetch(url, {
        redirect: "manual",
        headers: {
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        },
      });
      for (const line of response.headers.getSetCookie()) {
        const pair = line.split(";")[0]!;
        const index = pair.indexOf("=");
        jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) {
        return { status: response.status, url };
      }
      url = new URL(location, url).toString();
      if (new URL(url).pathname === "/done") {
        return { status: response.status, url };
      }
    }
  } finally {
    await alepha.stop();
    await idp.stop();
  }
};

describe("$auth({ oauth }) and the callback's iss", () => {
  it("signs in when the issuer names what the provider sends", async ({
    expect,
  }) => {
    const { url } = await signIn(GITHUB_ISS);
    expect(new URL(url).pathname).toBe("/done");
  });

  it("refuses the callback with the authorization URL as pseudo-issuer", async ({
    expect,
  }) => {
    const { status, url } = await signIn(undefined);
    expect(new URL(url).pathname).toBe("/oauth/callback");
    expect(status).toBe(403);
  });
});
