import { Alepha } from "alepha";
import { AlephaServerLinks, LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { $action, ServerProvider, ServerRouterProvider } from "../index.ts";

/**
 * Only a fetch reads the router trie and the server links, so a started app
 * that handles a cron or a queue message builds neither (#Q3396).
 */
class Probe extends ServerRouterProvider {
  public get queued(): number {
    return this.pending.length;
  }
}

class Links extends LinkProvider {
  public get queued(): number {
    return this.deferredRegistrations.length;
  }
}

class Api {
  ping = $action({ method: "GET", path: "/ping", handler: () => "pong" });
}

describe("HTTP tables built on the first fetch", () => {
  it("are not built by start, and are by the first request", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { SERVER_PORT: 0 } })
      .with({ provide: ServerRouterProvider, use: Probe })
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaServerLinks)
      .with(Api);
    await alepha.start();
    const router = alepha.inject(Probe);
    const links = alepha.inject(Links);

    // What a cron tick sees: started, nothing matched, no link read.
    expect(router.queued).toBeGreaterThan(0);
    expect(links.queued).toBe(1);

    const host = alepha.inject(ServerProvider).hostname;
    expect(await (await fetch(`${host}/api/ping`)).text()).toBe("pong");
    expect(router.queued).toBe(0);
    await alepha.stop();
  });
});
