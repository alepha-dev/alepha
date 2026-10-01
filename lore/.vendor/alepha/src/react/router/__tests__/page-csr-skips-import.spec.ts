import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { AlephaReactRouter } from "../index.ts";
import { $page } from "../primitives/$page.ts";
import {
  ReactPageProvider,
  type ReactRouterState,
} from "../providers/ReactPageProvider.ts";

/**
 * The minimum `ReactRouterState` `createLayers` reads.
 */
const stateFor = (path: string): ReactRouterState =>
  ({
    layers: [],
    url: new URL(`http://localhost${path}`),
    onError: () => undefined,
  }) as unknown as ReactRouterState;

/**
 * A CSR page's component must not be imported on the server.
 *
 * `createLayers` wraps the whole chain in `ClientOnly` when the matched route
 * opts out of SSR, so any element built for it is discarded — but the import
 * that produced it still happened, dragging that page's entire module graph
 * into the server runtime.
 *
 * On Node that is wasted memory. On Cloudflare Workers it took Lore's folio
 * route down in production: importing MDXEditor + Lexical server-side blew the
 * isolate's ceiling and killed it mid-stream, so the browser received the
 * early-head flush and nothing else. It never reproduced in dev or under
 * `node dist` — neither is workerd — which is why this is pinned by asserting
 * the import never happens rather than by measuring memory.
 */
describe("$page CSR does not import its component on the server", () => {
  const build = () => {
    let lazyCalls = 0;
    let loaderCalls = 0;

    class Router {
      csr = $page({
        path: "/heavy",
        name: "heavy",
        ssr: false,
        loader: () => {
          loaderCalls++;
          return { seeded: true };
        },
        lazy: async () => {
          lazyCalls++;
          return { default: () => null };
        },
      });

      ssr = $page({
        path: "/light",
        name: "light",
        ssr: true,
        lazy: async () => {
          lazyCalls++;
          return { default: () => null };
        },
      });
    }

    return {
      Router,
      counts: () => ({ lazyCalls, loaderCalls }),
    };
  };

  it("skips the lazy import but still runs the loader", async () => {
    const { Router, counts } = build();
    const alepha = Alepha.create().with(AlephaReactRouter).with(Router);
    await alepha.start();

    const pages = alepha.inject(ReactPageProvider);
    await pages.createLayers(pages.page("heavy"), stateFor("/heavy"));

    const { lazyCalls, loaderCalls } = counts();
    // The whole point: no import.
    expect(lazyCalls).toBe(0);
    // …but the data the client hydrates from still had to be fetched.
    expect(loaderCalls).toBe(1);
  });

  it("still imports a page that does server-render", async () => {
    const { Router, counts } = build();
    const alepha = Alepha.create().with(AlephaReactRouter).with(Router);
    await alepha.start();

    const pages = alepha.inject(ReactPageProvider);
    await pages.createLayers(pages.page("light"), stateFor("/light"));

    expect(counts().lazyCalls).toBe(1);
  });
});
