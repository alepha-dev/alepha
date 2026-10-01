import { Alepha } from "alepha";
import { $action, HttpClient, ServerProvider } from "alepha/server";
import {
  type GetApiLinksOptions,
  ServerLinksProvider,
} from "alepha/server/links";
import { describe, it } from "vitest";

import { $page } from "../index.ts";

/**
 * Counts registry builds, which is what the SSR path was paying for on every
 * rendered page: the result is identical for every request of one identity,
 * and it is awaited before the early head can open.
 */
class CountingServerLinksProvider extends ServerLinksProvider {
  public builds = 0;

  public override async getUserApiLinks(options: GetApiLinksOptions) {
    this.builds++;
    return super.getUserApiLinks(options);
  }
}

describe("ReactServerProvider api links", () => {
  it("should build the registry once across two SSR requests of the same identity", async ({
    expect,
  }) => {
    class App {
      hello = $action({
        handler: () => "hello",
      });

      home = $page({
        path: "/",
        component: () => "the page body",
      });
    }

    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      // Before the app: registering a page pulls the react server in, which
      // reaches ServerLinksProvider, and a service already in use cannot be
      // substituted.
      .with({ provide: ServerLinksProvider, use: CountingServerLinksProvider })
      .with(App);

    await alepha.start();

    const server = alepha.inject(ServerProvider);
    const http = alepha.inject(HttpClient);

    const first = await http.fetch(`${server.hostname}/`);
    const second = await http.fetch(`${server.hostname}/`);

    expect(first.data).toContain("the page body");
    expect(second.data).toContain("the page body");
    // Both documents still carry the registry, inlined for hydration.
    expect(second.data).toContain("alepha.server.request.apiLinks");

    expect(alepha.inject(CountingServerLinksProvider).builds).toBe(1);

    await alepha.stop();
  });
});
