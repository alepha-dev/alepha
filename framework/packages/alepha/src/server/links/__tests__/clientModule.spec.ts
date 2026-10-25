import { Alepha } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import {
  $route,
  AlephaServer,
  BunHttpServerProvider,
  NodeHttpServerProvider,
  ServerHealthProvider,
} from "alepha/server";
import { describe, expect, it } from "vitest";

import { AlephaServerLinks, AlephaServerLinksClient } from "../index.ts";
import { LinkProvider } from "../providers/LinkProvider.ts";
import { RemotePrimitiveProvider } from "../providers/RemotePrimitiveProvider.ts";
import { ServerLinksProvider } from "../providers/ServerLinksProvider.ts";

describe("AlephaServerLinksClient", () => {
  it("gives a consumer LinkProvider without registering a server", async () => {
    const alepha = Alepha.create().with(AlephaServerLinksClient);
    await alepha.start();

    expect(alepha.has(LinkProvider)).toBe(true);
    expect(alepha.has(ServerLinksProvider)).toBe(false);
    expect(alepha.has(RemotePrimitiveProvider)).toBe(false);

    // A base `ServerProvider` IS pulled in transitively, and that is fine: it
    // is the request-handling core, with no `listen()`, no `start` hook and no
    // port. It is exactly what `AlephaServer` registers for itself in
    // serverless mode. What must never appear is a provider that binds a
    // socket, so assert on those rather than on `ServerProvider`.
    expect(alepha.has(NodeHttpServerProvider)).toBe(false);
    expect(alepha.has(BunHttpServerProvider)).toBe(false);
  });

  it("declares no route, so nothing can bind a port", async () => {
    const alepha = Alepha.create().with(AlephaServerLinksClient);
    await alepha.start();

    const links = alepha.inject(LinkProvider).getServerLinks();
    expect(links).toHaveLength(0);
  });

  /**
   * `getServerLinks()` cannot answer this on its own: it returns what
   * `registerLink` was given, which is `$action` and `$sse` derived, so every
   * `$route` endpoint is invisible to it. The health probes, `/api/_links` and
   * `/api/_batch` are all `$route`, and they are exactly what someone would
   * find on a port that should not exist.
   */
  it("declares no $route either, health probes included", async () => {
    const alepha = Alepha.create().with(AlephaServerLinksClient);
    await alepha.start();

    expect(alepha.primitives($route).map((it) => it.options.path)).toEqual([]);
    expect(alepha.has(ServerHealthProvider)).toBe(false);
  });

  /**
   * The behavioural half of the same claim. Asserting only that a line is
   * absent would pass just as well if logging were broken, so the real server
   * runs first as a positive control: the same probe must see the line there.
   */
  it("never logs 'Server listening', where a real server does", async () => {
    const listened = async (mod: any) => {
      const alepha = Alepha.create().with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
      });
      alepha.with(mod);
      await alepha.start();

      return alepha
        .inject(MemoryDestinationProvider)
        .logs.some((entry) => entry.message.includes("Server listening"));
    };

    expect(await listened(AlephaServer)).toBe(true);
    expect(await listened(AlephaServerLinksClient)).toBe(false);
  });

  it("AlephaServerLinks still brings the whole thing", async () => {
    const alepha = Alepha.create().with(AlephaServerLinks);
    await alepha.start();

    expect(alepha.has(LinkProvider)).toBe(true);
    expect(alepha.has(ServerLinksProvider)).toBe(true);
    expect(alepha.has(RemotePrimitiveProvider)).toBe(true);
  });
});
