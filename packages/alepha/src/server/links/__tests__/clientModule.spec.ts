import { Alepha } from "alepha";
import { BunHttpServerProvider, NodeHttpServerProvider } from "alepha/server";
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

  it("AlephaServerLinks still brings the whole thing", async () => {
    const alepha = Alepha.create().with(AlephaServerLinks);
    await alepha.start();

    expect(alepha.has(LinkProvider)).toBe(true);
    expect(alepha.has(ServerLinksProvider)).toBe(true);
    expect(alepha.has(RemotePrimitiveProvider)).toBe(true);
  });
});
