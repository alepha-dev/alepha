import { $hook, Alepha, z } from "alepha";
import {
  $secure,
  AlephaSecurity,
  JwtProvider,
  SecurityProvider,
} from "alepha/security";
import { $action, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  AlephaServerLinks,
  AlephaServerLinksClient,
  LinkProvider,
} from "../index.ts";

class Vault {
  open = $action({
    schema: { response: z.text() },
    handler: () => "open",
  });

  sealed = $action({
    use: [$secure()],
    schema: { response: z.text() },
    handler: ({ headers }) => headers.authorization ?? "no credential",
  });
}

/**
 * Records the authorization header of every request leaving this container,
 * registry fetches included.
 */
class SentHeaders {
  public readonly sent: Array<{ url: string; authorization: string | null }> =
    [];

  protected readonly capture = $hook({
    on: "client:beforeFetch",
    handler: ({ url, request }) => {
      this.sent.push({
        url,
        authorization: new Headers(request.headers).get("authorization"),
      });
    },
  });
}

const serve = async () => {
  const alepha = Alepha.create()
    .with(AlephaServerLinks)
    .with(AlephaSecurity)
    .with(Vault);
  await alepha.start();

  const jwt = alepha.inject(JwtProvider);
  const realm = alepha.inject(SecurityProvider).getRealms()[0]?.name;
  const token = await jwt.create({ sub: "u1", roles: [] }, realm, {
    header: { typ: jwt.accessTokenTyp },
  });

  return {
    hostname: alepha.inject(ServerProvider).hostname,
    authorization: `Bearer ${token}`,
  };
};

const consumer = () =>
  Alepha.create().with(AlephaServerLinksClient).with(SentHeaders);

describe("$client credential", () => {
  /**
   * ⚠️ The one that matters. `/api/_links` prunes every action the caller may
   * not invoke, so an anonymous registry fetch omits each `$secure` one - and
   * the failure is `Action not found` for a route that plainly exists and that
   * the caller is plainly allowed to call.
   */
  it("decides which actions the registry even contains", async () => {
    const { hostname, authorization } = await serve();

    const alepha = consumer();
    await alepha.start();
    const links = alepha.inject(LinkProvider);

    const anonymous = await links.fetchLinks({ hostname });
    expect(anonymous.map((it) => it.name)).toEqual(["open"]);

    const authenticated = await links.fetchLinks({ hostname, authorization });
    expect(authenticated.map((it) => it.name).sort()).toEqual([
      "open",
      "sealed",
    ]);
  });

  it("refuses a secured action without it and returns one with it", async () => {
    const { hostname, authorization } = await serve();

    const alepha = consumer();
    await alepha.start();
    const links = alepha.inject(LinkProvider);

    await expect(links.client<Vault>({ hostname }).sealed()).rejects.toThrow(
      "Action sealed not found",
    );

    expect(
      await links.client<Vault>({ hostname, authorization }).sealed(),
    ).toBe(authorization);
  });

  it("keeps two credentials for one host apart", async () => {
    const { hostname, authorization } = await serve();

    const alepha = consumer();
    await alepha.start();
    const links = alepha.inject(LinkProvider);

    // Anonymous first, so a host-only cache key would hand its pruned registry
    // to the authenticated caller that follows.
    await expect(links.client<Vault>({ hostname }).sealed()).rejects.toThrow(
      "Action sealed not found",
    );

    expect(
      await links.client<Vault>({ hostname, authorization }).sealed(),
    ).toBe(authorization);

    // ...and back, which is the same trap in the other direction.
    await expect(links.client<Vault>({ hostname }).sealed()).rejects.toThrow(
      "Action sealed not found",
    );
  });

  it("carries the credential on the registry fetch, not only the call", async () => {
    const { hostname, authorization } = await serve();

    const alepha = consumer();
    await alepha.start();

    await alepha
      .inject(LinkProvider)
      .client<Vault>({ hostname, authorization })
      .sealed();

    const sent = alepha.inject(SentHeaders).sent;
    expect(sent.map((it) => it.authorization)).toEqual([
      authorization,
      authorization,
    ]);
    expect(sent[0].url).toBe(`${hostname}${LinkProvider.path.apiLinks}`);
  });

  it("re-evaluates a thunk per request rather than resolving it once", async () => {
    const { hostname } = await serve();

    let calls = 0;
    const alepha = consumer();
    await alepha.start();

    const vault = alepha.inject(LinkProvider).client<Vault>({
      hostname,
      authorization: () => {
        calls++;
        return `Bearer token-${calls}`;
      },
    });

    await vault.open();
    await vault.open();
    await vault.open();

    // A token that refreshes is the whole reason a thunk is accepted; a client
    // that resolved it once would work for an hour and then fail for good.
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("puts a scope credential above ALS and below a per-call header", async () => {
    const { hostname } = await serve();

    const alepha = consumer();
    await alepha.start();
    const links = alepha.inject(LinkProvider);

    // The ambient incoming request a server would be proxying on behalf of.
    const ambient = <T>(fn: () => Promise<T>) =>
      alepha.context.run(async () => {
        alepha.set("alepha.http.request", {
          headers: { authorization: "Bearer als" },
        } as any);
        return await fn();
      });

    // No scope credential: ALS still fills it in, exactly as before.
    expect(await ambient(() => links.client<Vault>({ hostname }).open())).toBe(
      "open",
    );
    expect(alepha.inject(SentHeaders).sent.at(-1)?.authorization).toBe(
      "Bearer als",
    );

    // A scope credential is the caller speaking for itself, and wins.
    await ambient(() =>
      links.client<Vault>({ hostname, authorization: "Bearer scope" }).open(),
    );
    expect(alepha.inject(SentHeaders).sent.at(-1)?.authorization).toBe(
      "Bearer scope",
    );

    // And a per-call header wins over the scope.
    await ambient(() =>
      links
        .client<Vault>({ hostname, authorization: "Bearer scope" })
        .open({}, { request: { headers: { authorization: "Bearer call" } } }),
    );
    expect(alepha.inject(SentHeaders).sent.at(-1)?.authorization).toBe(
      "Bearer call",
    );
  });

  it("puts scope headers below the dedicated credential", async () => {
    const { hostname } = await serve();

    const alepha = consumer();
    await alepha.start();

    await alepha
      .inject(LinkProvider)
      .client<Vault>({
        hostname,
        headers: { authorization: "Bearer weak", "x-tenant": "acme" },
        authorization: "Bearer strong",
      })
      .open();

    const sent = alepha.inject(SentHeaders).sent.at(-1);
    expect(sent?.authorization).toBe("Bearer strong");
  });
});
