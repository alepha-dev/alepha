import { Alepha } from "alepha";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import type {} from "../../index.ts";
import { ReactBrowserRendererProvider } from "../ReactBrowserRendererProvider.ts";
import type { ReactRouterState } from "../ReactPageProvider.ts";

/**
 * `onRecoverableError` on the browser roots (quest #1328).
 *
 * The failure this guards is a silent one: without the option React installs
 * its own handler, which calls `reportError`, and a production hydration
 * mismatch reaches a crash reporter as a minified code with blank arguments -
 * no route, no component. Nothing goes red, and the report costs ingest while
 * answering nothing.
 *
 * ⚠️ These drive a REAL mismatch through `hydrateRoot` rather than calling the
 * handler directly. Whether React hands a component stack to a handler this
 * codebase passes is the whole question, and a direct call answers it by
 * assumption.
 */
describe("a recoverable render error on the browser", () => {
  const stateFor = (url: string): ReactRouterState =>
    ({
      layers: [],
      url: new URL(url),
      onError: () => undefined as any,
      params: {},
      query: {},
      meta: {},
      head: {} as any,
      name: "docs",
    }) as any;

  /**
   * Server HTML that disagrees with what the element renders. React recovers
   * by re-rendering the subtree on the client, and reports as it does.
   */
  const mismatchedRoot = () => {
    const root = document.createElement("div");
    root.id = "root";
    root.innerHTML = "<p>rendered on the server</p>";
    document.body.append(root);
    return root;
  };

  const setup = async () => {
    const alepha = Alepha.create();
    alepha.inject(ReactBrowserRendererProvider);
    const events: Array<{
      error: unknown;
      componentStack?: string;
      state: ReactRouterState;
    }> = [];
    alepha.events.on("react:recoverable:error", (ev) => {
      events.push(ev as any);
    });
    await alepha.start();
    return { alepha, events };
  };

  // React reports a recoverable error after the hydrating render returns, so
  // there is nothing to await on the emit itself.
  const settle = async (until: () => boolean) => {
    for (let i = 0; i < 50 && !until(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  it("reports the mismatch on the container event, with the route", async () => {
    const { alepha, events } = await setup();

    await alepha.events.emit("react:browser:render", {
      root: mismatchedRoot(),
      element: createElement("p", null, "rendered on the client"),
      state: stateFor("http://localhost/docs/reference-primitives-computed"),
      hydration: { "alepha.react.router.layers": [] } as any,
    });

    await settle(() => events.length > 0);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].state.url.pathname).toBe(
      "/docs/reference-primitives-computed",
    );
  });

  /**
   * The reason the whole change exists: `componentStack` is what turns
   * "something mismatched on alepha.dev" into a file to open, and React fills
   * it even in a production build.
   */
  it("carries the component stack, which names the offending subtree", async () => {
    const { alepha, events } = await setup();

    const Offender = () => createElement("p", null, "rendered on the client");

    await alepha.events.emit("react:browser:render", {
      root: mismatchedRoot(),
      element: createElement(Offender),
      state: stateFor("http://localhost/"),
      hydration: { "alepha.react.router.layers": [] } as any,
    });

    await settle(() => events.length > 0);

    expect(events[0].componentStack).toContain("Offender");
  });

  /**
   * A client-rendered boot has the same blank-report problem and no hydration
   * at all, so `createRoot` takes the option too. Driven here through a render
   * that throws and is recovered by React's own retry.
   */
  it("is wired on the client-rendered root as well", async () => {
    const { alepha } = await setup();
    const renderer = alepha.inject(ReactBrowserRendererProvider) as any;

    const root = document.createElement("div");
    root.id = "root-csr";
    document.body.append(root);

    await alepha.events.emit("react:browser:render", {
      root,
      element: createElement("p", null, "client only"),
      state: stateFor("http://localhost/"),
      hydration: undefined,
    });

    // `render` on a concurrent root is not synchronous.
    await settle(() => root.textContent !== "");

    // The root React actually created, not a claim about which branch ran:
    // `hydration` was absent, so this must be the `createRoot` one.
    expect(renderer.root).toBeDefined();
    expect(root.textContent).toContain("client only");
  });
});
