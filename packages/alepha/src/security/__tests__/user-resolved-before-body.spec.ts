import { Alepha, z } from "alepha";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { AlephaServerCookies } from "alepha/server/cookies";
import { describe, test } from "vitest";
import { AlephaSecurity } from "../index.ts";
import { SecurityProvider } from "../providers/SecurityProvider.ts";

/**
 * Resolves a user only when it can read a cookie, which is what a session
 * resolver does. Returning nothing otherwise is the whole point: it makes the
 * ordering visible instead of letting a header-only fake paper over it.
 */
class CookieSecurityProvider extends SecurityProvider {
  public seenCookies: Record<string, unknown> | undefined;

  public override async resolveUserFromServerRequest(
    request: any,
  ): Promise<any> {
    this.seenCookies = request.cookies;
    if (!request.cookies?.req?.session) {
      return undefined;
    }
    return { id: "u1", name: "Alice", roles: [] };
  }
}

class Api {
  whoami = $action({
    path: "/whoami",
    schema: { response: z.text() },
    handler: async ({ user }) => user?.id ?? "anonymous",
  });
}

/**
 * The ordering constraint this hook actually lives under.
 *
 * `ServerSecurityProvider.onServerRequest` runs `priority: "last"`, and that is
 * load-bearing: `ServerCookiesProvider` fills `request.cookies` from a hook in
 * the *normal* tier, and tiers resolve first → normal → last. Move security to
 * `first` and every cookie-borne session resolves to nobody — the request goes
 * anonymous and `$secure` refuses it.
 *
 * That is not hypothetical. It shipped, and it took two Playwright uploads
 * failing to find it, because a bearer token still worked and only the cookie
 * path broke. A docblock here once claimed resolution "takes only `url` and
 * `headers`, so it cannot want a body that has not been parsed yet" — true
 * about the body, wrong about what it does want.
 */
describe("user resolution runs after the cookies are parsed", () => {
  test("a cookie-borne session resolves to a user", async ({ expect }) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: SecurityProvider, use: CookieSecurityProvider })
      .with(AlephaServer)
      .with(AlephaServerCookies)
      .with(AlephaSecurity)
      .with(Api);
    await alepha.start();

    await fetch(`${alepha.inject(ServerProvider).hostname}/api/whoami`, {
      headers: { cookie: "session=abc" },
    });

    // The cookies were parsed by the time the resolver ran. That is the whole
    // invariant: with security in the `first` tier this is `undefined`, every
    // cookie-borne session resolves to nobody, and `$secure` refuses requests
    // that carry a perfectly good login.
    expect(alepha.inject(CookieSecurityProvider).seenCookies).toMatchObject({
      req: { session: "abc" },
    });
  });
});
