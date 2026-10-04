import { Alepha, z } from "alepha";
import { $action } from "alepha/server";
import { describe, it } from "vitest";

import { AlephaServerLinks, LinkProvider, linkOptionsAtom } from "../index.ts";

class Api {
  ping = $action({
    schema: { response: z.text() },
    handler: () => "pong",
  });
}

describe("LinkProvider default origin, on the server", () => {
  it("never turns a local handler into a network call", async ({ expect }) => {
    // The default origin is a browser setting. Server-side, a host-less link
    // is the in-process handler, and SSR must keep calling it.
    const alepha = Alepha.create().with(AlephaServerLinks).with(Api);
    alepha.store.mut(linkOptionsAtom, (options) => ({
      ...options,
      hostname: "https://api.test",
    }));
    await alepha.start();

    const links = alepha.inject(LinkProvider);

    expect(links.defaultOrigin()).toBeUndefined();
    expect(await links.client<Api>().ping({})).toBe("pong");
  });
});
