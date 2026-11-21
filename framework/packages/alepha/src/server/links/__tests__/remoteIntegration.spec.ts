import { Alepha, z } from "alepha";
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
    path: "/weather",
    method: "GET",
    schema: { response: z.text() },
    handler: () => "clear",
  });

  logbook = $action({
    path: "/logbook",
    method: "GET",
    use: [$secure()],
    schema: { response: z.text() },
    handler: () => "kept",
  });

  ticks = $sse({
    path: "/ticks",
    schema: { data: z.object({ tick: z.integer() }) },
    handler: ({ emit }) => {
      emit({ tick: 1 });
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
const consumer = () => Alepha.create().with(AlephaServerLinksClient);

describe("$client against a remote Alepha app", () => {
  it("resolves and calls an anonymous action", async () => {
    const { hostname } = await serve(Observatory, true);

    const alepha = consumer();
    await alepha.start();

    const remote = alepha.inject(LinkProvider).client<Observatory>({
      hostname,
    });

    expect(await remote.weather()).toBe("clear");
  });

  /**
   * `clientModule.spec.ts` asserts this of a consumer that has called
   * nothing. This is the other half: still true once it has resolved a
   * remote registry and made a call.
   */
  it("registers no route and binds no port, having called a host", async () => {
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
});
