import { Alepha } from "alepha";
import { ErrorBoundary } from "alepha/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import type {} from "../../index.ts";
import { ReactBrowserRendererProvider } from "../ReactBrowserRendererProvider.ts";
import type { ReactRouterState } from "../ReactPageProvider.ts";

/**
 * `react:render:caught` (#Q3186).
 *
 * The failure this guards is a silent one: React fires no `window.onerror`
 * for an error a boundary caught, so a client-side render crash showed its
 * fallback and reached no crash reporter at all.
 *
 * ⚠️ These throw from a REAL component under a REAL boundary through
 * `createRoot`, rather than calling the handler directly: whether React hands
 * the error and its component stack to the root option is the whole question.
 */
describe("a render error an error boundary caught on the browser", () => {
  const stateFor = (url: string, name: string): ReactRouterState =>
    ({
      layers: [],
      url: new URL(url),
      onError: () => undefined as any,
      params: {},
      query: {},
      meta: {},
      head: {} as any,
      name,
    }) as any;

  const Exploding = () => {
    throw new Error("page exploded");
  };

  const element = () =>
    createElement(
      ErrorBoundary,
      { fallback: () => createElement("p", null, "fallback shown") },
      createElement(Exploding),
    );

  const setup = async () => {
    const alepha = Alepha.create();
    alepha.inject(ReactBrowserRendererProvider);
    const events: Array<{
      error: unknown;
      componentStack?: string;
      state?: ReactRouterState;
    }> = [];
    alepha.events.on("react:render:caught", (ev) => {
      events.push(ev);
    });
    await alepha.start();
    return { alepha, events };
  };

  const mount = () => {
    const root = document.createElement("div");
    document.body.append(root);
    return root;
  };

  const settle = async (until: () => boolean) => {
    for (let i = 0; i < 50 && !until(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  it("emits the error once, with the component stack, while the fallback shows", async () => {
    const { alepha, events } = await setup();
    const root = mount();

    await alepha.events.emit("react:browser:render:before", {
      root,
      element: element(),
      state: stateFor("http://localhost/", "home"),
      hydration: undefined,
    });

    await settle(() => root.textContent === "fallback shown");
    await settle(() => events.length > 0);

    expect(root.textContent).toBe("fallback shown");
    expect(events).toHaveLength(1);
    expect((events[0].error as Error).message).toBe("page exploded");
    expect(events[0].componentStack).toContain("Exploding");
  });

  /**
   * The boot's state is captured once, at the first render. A crash after a
   * navigation must name the page it happened on, which is the store's.
   */
  it("names the route on screen at the moment of the crash, not the boot's", async () => {
    const { alepha, events } = await setup();
    alepha.store.set(
      "alepha.react.router.state",
      stateFor("http://localhost/projects/42", "project"),
    );

    await alepha.events.emit("react:browser:render:before", {
      root: mount(),
      element: element(),
      state: stateFor("http://localhost/", "home"),
      hydration: undefined,
    });

    await settle(() => events.length > 0);

    expect(events[0].state?.name).toBe("project");
    expect(events[0].state?.url.pathname).toBe("/projects/42");
  });

  /**
   * Why a reporter must subscribe to the event: the window hears nothing.
   */
  it("reaches no window error listener", async () => {
    const { alepha, events } = await setup();
    const heard: unknown[] = [];
    const listener = (e: ErrorEvent) => heard.push(e.error);
    window.addEventListener("error", listener);

    try {
      await alepha.events.emit("react:browser:render:before", {
        root: mount(),
        element: element(),
        state: stateFor("http://localhost/", "home"),
        hydration: undefined,
      });
      await settle(() => events.length > 0);
    } finally {
      window.removeEventListener("error", listener);
    }

    expect(events).toHaveLength(1);
    expect(heard).toHaveLength(0);
  });
});
