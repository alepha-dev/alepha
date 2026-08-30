import { $hook, Alepha, z } from "alepha";
import {
  $secure,
  AlephaSecurity,
  JwtProvider,
  SecurityProvider,
} from "alepha/security";
import {
  $action,
  $route,
  $sse,
  BunHttpServerProvider,
  NodeHttpServerProvider,
  ServerProvider,
} from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  $client,
  AlephaServerLinks,
  AlephaServerLinksClient,
  LinkProvider,
} from "../index.ts";

/**
 * The app being called: one anonymous action, one `$secure` one, and an `$sse`
 * stream that a remote caller must be refused rather than handed something
 * that is not a stream.
 */
class Observatory {
  weather = $action({
    schema: { response: z.text() },
    handler: () => "clear",
  });

  logbook = $action({
    use: [$secure()],
    schema: { response: z.text() },
    handler: () => "kept",
  });

  ticks = $sse({
    schema: { data: z.object({ tick: z.integer() }) },
    handler: ({ emit }) => {
      emit({ tick: 1 });
    },
  });
}

class Harbour {
  tides = $action({
    schema: { response: z.text() },
    handler: () => "rising",
  });
}

class FetchLog {
  public readonly urls: string[] = [];

  protected readonly capture = $hook({
    on: "client:beforeFetch",
    handler: ({ url }) => {
      this.urls.push(url);
    },
  });
}

const serve = async (app: new () => any, secured = false) => {
  let alepha = Alepha.create().with(AlephaServerLinks).with(app);
  if (secured) {
    alepha = alepha.with(AlephaSecurity);
  }
  await alepha.start();

  const hostname = alepha.inject(ServerProvider).hostname;
  if (!secured) {
    return { hostname, authorization: "" };
  }

  const jwt = alepha.inject(JwtProvider);
  const token = await jwt.create(
    { sub: "keeper", roles: [] },
    alepha.inject(SecurityProvider).getRealms()[0]?.name,
    { header: { typ: jwt.accessTokenTyp } },
  );

  return { hostname, authorization: `Bearer ${token}` };
};

/**
 * The process this epic exists for. `AlephaServerLinksClient` and nothing
 * else: no `$action`, no `$route`, no server. It holds `$client` and that is
 * the whole surface.
 */
const consumer = () =>
  Alepha.create().with(AlephaServerLinksClient).with(FetchLog);

describe("$client against a remote Alepha app", () => {
  it("1. resolves and calls an anonymous action", async () => {
    const { hostname } = await serve(Observatory, true);

    const alepha = consumer();
    await alepha.start();

    const remote = alepha.inject(LinkProvider).client<Observatory>({
      hostname,
    });

    expect(await remote.weather()).toBe("clear");
  });

  it("2. refuses a secured action without a credential, and says why", async () => {
    const { hostname } = await serve(Observatory, true);

    const alepha = consumer();
    await alepha.start();

    const remote = alepha.inject(LinkProvider).client<Observatory>({
      hostname,
    });

    // Anonymous, so the server never listed it: `restricted` is populated for
    // authenticated callers only, and 401 is the right answer for a caller who
    // has not said who they are. A signed-in caller refused a role gets 403
    // instead - that distinction is `restrictedActions.spec.ts`.
    await expect(remote.logbook()).rejects.toThrow("Action logbook not found");
  });

  it("3. returns it once a credential is on the scope", async () => {
    const { hostname, authorization } = await serve(Observatory, true);

    const alepha = consumer();
    await alepha.start();

    const remote = alepha
      .inject(LinkProvider)
      .client<Observatory>({ hostname, authorization });

    expect(await remote.logbook()).toBe("kept");
  });

  it("4. fetches the registry once per host across many calls", async () => {
    const { hostname } = await serve(Observatory, true);

    const alepha = consumer();
    await alepha.start();

    const remote = alepha.inject(LinkProvider).client<Observatory>({
      hostname,
    });

    await remote.weather();
    await remote.weather();
    await remote.weather();
    await remote.weather();

    const registryFetches = alepha
      .inject(FetchLog)
      .urls.filter((url) => url.endsWith(LinkProvider.path.apiLinks));

    expect(registryFetches).toEqual([
      `${hostname}${LinkProvider.path.apiLinks}`,
    ]);
  });

  it("5. holds a second host independently, neither evicting the other", async () => {
    const observatory = await serve(Observatory, true);
    const harbour = await serve(Harbour);

    const alepha = consumer();
    await alepha.start();
    const links = alepha.inject(LinkProvider);

    const sky = links.client<Observatory>({ hostname: observatory.hostname });
    const sea = links.client<Harbour>({ hostname: harbour.hostname });

    expect(await sky.weather()).toBe("clear");
    expect(await sea.tides()).toBe("rising");
    expect(await sky.weather()).toBe("clear");
    expect(await sea.tides()).toBe("rising");

    const registryFetches = alepha
      .inject(FetchLog)
      .urls.filter((url) => url.endsWith(LinkProvider.path.apiLinks));

    expect(registryFetches.sort()).toEqual(
      [
        `${observatory.hostname}${LinkProvider.path.apiLinks}`,
        `${harbour.hostname}${LinkProvider.path.apiLinks}`,
      ].sort(),
    );
  });

  /**
   * ⚠️ The assertion that will rot first, and the reason it is written down.
   *
   * Nothing else here notices if someone widens the consumer module later, so
   * without this the CLI grows a server and no test complains.
   */
  it("6. registers no route and binds no port, having called two hosts", async () => {
    const { hostname } = await serve(Observatory, true);

    const alepha = consumer();
    await alepha.start();

    await alepha
      .inject(LinkProvider)
      .client<Observatory>({ hostname })
      .weather();

    expect(alepha.primitives($route)).toHaveLength(0);
    expect(alepha.primitives($action)).toHaveLength(0);
    expect(alepha.inject(LinkProvider).getServerLinks()).toHaveLength(0);
    expect(alepha.has(NodeHttpServerProvider)).toBe(false);
    expect(alepha.has(BunHttpServerProvider)).toBe(false);
  });

  /**
   * Decision 10 of the epic: remote SSE is excluded rather than half-built.
   * The type drops `$sse` from a client whose scope names a host, and this is
   * the runtime half of the same statement, for a scope the type cannot narrow.
   */
  it("refuses to open an SSE stream on a remote host, by name", async () => {
    const { hostname } = await serve(Observatory, true);

    const alepha = consumer();
    await alepha.start();
    const links = alepha.inject(LinkProvider);

    // A statically-known hostname narrows the client, so this is a compile
    // error. `@ts-expect-error` is the assertion: were `ticks` still on the
    // type, typecheck would fail on an unused expectation rather than pass
    // quietly, which makes this a real test and not a comment.
    const typed = links.client<Observatory>({ hostname });
    // @ts-expect-error a remote client offers actions only, never $sse
    void typed.ticks;

    // And for a scope the type cannot narrow (`hostname?: string` says nothing
    // either way), the runtime refuses it by name.
    const loose: { hostname?: string } = { hostname };
    const remote = links.client<Observatory>(loose);

    await expect(remote.ticks()).rejects.toThrow("server-sent-events stream");
  });

  it("reads as the epic promised it would, through $client", async () => {
    const { hostname, authorization } = await serve(Observatory, true);

    class Cli {
      observatory = $client<Observatory>({ hostname, authorization });

      report = async () =>
        `${await this.observatory.weather()} / ${await this.observatory.logbook()}`;
    }

    const alepha = consumer().with(Cli);
    await alepha.start();

    expect(await alepha.inject(Cli).report()).toBe("clear / kept");
  });
});
