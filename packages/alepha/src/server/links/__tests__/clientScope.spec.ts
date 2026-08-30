import { Alepha, z } from "alepha";
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
});
