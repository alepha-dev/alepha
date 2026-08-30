import { $hook, Alepha, z } from "alepha";
import { $action } from "alepha/server";
import { describe, expect, it } from "vitest";

import { AlephaServerLinksClient, LinkProvider } from "../index.ts";

class Api {
  ping = $action({
    schema: { response: z.text() },
    handler: () => "pong",
  });
}

/**
 * `client:beforeFetch` carries the URL the client is about to request, which
 * is the only place the composed prefix is observable.
 */
class FetchProbe {
  public readonly urls: string[] = [];

  protected readonly capture = $hook({
    on: "client:beforeFetch",
    handler: ({ url }) => {
      this.urls.push(url);
    },
  });
}

/**
 * The registry a server running on a non-default `serverApi.prefix` serves.
 */
const registry = {
  prefix: "/v1",
  actions: {
    ping: { path: "/ping" },
  },
};

describe("registry prefix", () => {
  /**
   * `loadRegistry` copied path, kind, method, contentType and service off each
   * entry and ignored the response's top-level `prefix`, even though
   * `ServerLinksProvider` fills it from `serverApi.prefix`. `followRemote` then
   * fell back to `/api` for every registry-derived link.
   *
   * Harmless while every caller is same-origin on the default prefix, wrong for
   * any app that sets its own, and wrong for every remote host in this epic.
   */
  it("is carried onto every link loadRegistry builds", async () => {
    const alepha = Alepha.create().with(AlephaServerLinksClient);
    await alepha.start();

    alepha.store.set("alepha.server.request.apiLinks", registry);

    expect(alepha.inject(LinkProvider).links).toEqual([
      { name: "ping", path: "/ping", prefix: "/v1" },
    ]);
  });

  it("is what the request is actually addressed to", async () => {
    const alepha = Alepha.create()
      .with(AlephaServerLinksClient)
      .with(FetchProbe);
    await alepha.start();

    alepha.store.set("alepha.server.request.apiLinks", registry);

    // `.fetch()` rather than the plain call: in a browser the plain call is
    // coalesced by the batch collector and would address `/api/_batch`.
    // The fetch itself has no server to reach, and that is fine — the URL is
    // decided before it leaves.
    await alepha
      .inject(LinkProvider)
      .client<Api>()
      .ping.fetch({})
      .catch(() => undefined);

    expect(alepha.inject(FetchProbe).urls).toEqual(["/v1/ping"]);
  });
});
