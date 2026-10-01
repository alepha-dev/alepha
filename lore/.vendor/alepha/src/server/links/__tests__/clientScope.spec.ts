import { $hook, Alepha, z } from "alepha";
import {
  $action,
  type ClientRequestOptions,
  ServerProvider,
} from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  type ClientScope,
  LinkProvider,
  ServerLinksProvider,
} from "../index.ts";

class App {
  echo = $action({
    schema: { response: z.text() },
    handler: ({ headers }) => headers["x-scope"] ?? "missing",
  });
}

/**
 * The absolute URL a request went out to, which is what a dropped hostname
 * takes away.
 */
class UrlProbe {
  public readonly urls: string[] = [];

  protected readonly capture = $hook({
    on: "client:beforeFetch",
    handler: ({ url }) => {
      this.urls.push(url);
    },
  });
}

describe("$client scope", () => {
  /**
   * `createVirtualAction` builds three call shapes off one scope, and `.fetch()`
   * was the odd one out: it used the scope to RESOLVE the link and then handed
   * `followRemote` the bare per-call options. The hostname survived because it
   * is baked into the resolved link; nothing else did.
   *
   * Invisible while `ClientScope` was `{ service, hostname }`, and the sharpest
   * bug in the epic the moment it carries a credential — `.fetch()` would go
   * out unauthenticated while the identical plain call succeeded.
   */
  it("reaches .fetch() the same way it reaches the plain call", async () => {
    const alepha = Alepha.create().with(App).with(ServerLinksProvider);
    await alepha.start();

    const scope: ClientScope & ClientRequestOptions = {
      hostname: alepha.inject(ServerProvider).hostname,
      request: { headers: { "x-scope": "reached" } },
    };
    const app = alepha.inject(LinkProvider).client<App>(scope);

    // The plain call merges `{ ...scope, ...options }`, and always has.
    expect(await app.echo()).toBe("reached");

    // `.fetch()` sends the same request, or the two disagree about what the
    // caller asked for.
    expect(await app.echo.fetch({}).then((it) => it.data)).toBe("reached");
  });

  /**
   * A `ClientScope` is an interface, so a class instance satisfies it - and
   * `ServerProvider`, the one instance anything actually passes, exposes
   * `hostname` as a **prototype getter**.
   *
   * A spread copies own enumerable properties only, so such a scope merges to
   * one naming no host: the call falls back to the local registry, resolves a
   * link with no `host`, and hands `fetch` a relative URL it refuses with
   * `ERR_INVALID_URL`. Nothing about the failure points at the spread.
   */
  it("reads a scope whose hostname is a prototype getter", async () => {
    const alepha = Alepha.create()
      .with(App)
      .with(ServerLinksProvider)
      .with(UrlProbe);
    await alepha.start();

    const server = alepha.inject(ServerProvider);
    const app = alepha.inject(LinkProvider).client<App>(server);

    expect(await app.echo.fetch({}).then((it) => it.data)).toBe("missing");
    expect(alepha.inject(UrlProbe).urls.at(-1)).toBe(
      `${server.hostname}/api/echo`,
    );
  });
});
