import { $hook, Alepha, z } from "alepha";
import { $action } from "alepha/server";
import { describe, it } from "vitest";

import {
  AlephaServerLinksClient,
  type ClientScope,
  LinkProvider,
  linkOptionsAtom,
} from "../index.ts";

class Api {
  ping = $action({
    schema: { response: z.text() },
    handler: () => "pong",
  });
}

/**
 * Every request the client is about to make: URL and authorization header.
 */
class FetchProbe {
  public readonly requests: Array<{ url: string; authorization?: string }> = [];

  protected readonly capture = $hook({
    on: "client:beforeFetch",
    handler: ({ url, request }) => {
      this.requests.push({
        url,
        authorization:
          new Headers(request.headers).get("authorization") ?? undefined,
      });
    },
  });
}

const registry = { actions: { ping: { path: "/ping" } } };

/**
 * A browser container whose host-less calls go to `https://api.test`, the
 * way a native shell is configured.
 */
const setup = async (opts: { registry?: boolean } = {}) => {
  const alepha = Alepha.create().with(AlephaServerLinksClient).with(FetchProbe);
  alepha.store.mut(linkOptionsAtom, (options) => ({
    ...options,
    hostname: "https://api.test",
  }));
  await alepha.start();
  if (opts.registry !== false) {
    alepha.store.set("alepha.server.request.apiLinks", registry);
  }
  const links = alepha.inject(LinkProvider);
  const probe = alepha.inject(FetchProbe);
  return { alepha, links, probe };
};

describe("LinkProvider default origin", () => {
  it("sends a host-less call to the default origin, unbatched", async ({
    expect,
  }) => {
    // The plain call, which in a browser is normally coalesced into a
    // relative /api/_batch: the WebView's own origin in a native shell.
    const { links, probe } = await setup();

    await links
      .client<Api>()
      .ping({})
      .catch(() => undefined);

    expect(probe.requests.map((r) => r.url)).toEqual([
      "https://api.test/api/ping",
    ]);
  });

  it("fetches the registry from the default origin, never the relative path", async ({
    expect,
  }) => {
    const { links, probe } = await setup({ registry: false });

    await links
      .client<Api>()
      .ping({})
      .catch(() => undefined);

    expect(probe.requests[0]?.url).toBe("https://api.test/api/_links");
  });

  it("sends the default credential to the default origin only", async ({
    expect,
  }) => {
    const { links, probe } = await setup();
    links.setDefaultAuthorization(async () => "Bearer native-token");

    await links
      .client<Api>()
      .ping({})
      .catch(() => undefined);
    await links
      .client<Api>({ hostname: "https://other.test" })
      .ping({})
      .catch(() => undefined);

    expect(probe.requests).toEqual([
      {
        url: "https://api.test/api/ping",
        authorization: "Bearer native-token",
      },
      { url: "https://other.test/api/_links", authorization: undefined },
    ]);
  });

  it("lets the client's own credential win over the default one", async ({
    expect,
  }) => {
    const { links, probe } = await setup();
    links.setDefaultAuthorization(() => "Bearer native-token");

    await links
      .client<Api>({ authorization: "Bearer explicit" })
      .ping({})
      .catch(() => undefined);

    expect(probe.requests[0]?.authorization).toBe("Bearer explicit");
  });

  it("lets a call's hostname win over the client's scope and the default", async ({
    expect,
  }) => {
    const { links, probe } = await setup();

    await links
      .client<Api>({ hostname: "https://scope.test" })
      // `mergeScope` reads a call's `hostname`, which `ClientRequestOptions`
      // does not declare: the scope type does.
      .ping({}, { hostname: "https://call.test" } as ClientScope as any)
      .catch(() => undefined);

    expect(probe.requests[0]?.url).toBe("https://call.test/api/_links");
  });

  it("changes nothing for a browser without a default origin", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaServerLinksClient)
      .with(FetchProbe);
    await alepha.start();
    alepha.store.set("alepha.server.request.apiLinks", registry);

    await alepha
      .inject(LinkProvider)
      .client<Api>()
      .ping.fetch({})
      .catch(() => undefined);

    expect(alepha.inject(FetchProbe).requests[0]?.url).toBe("/api/ping");
  });
});
