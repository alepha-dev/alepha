import { renderHook, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaReact } from "alepha/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { AlephaContext } from "../../core/contexts/AlephaContext.ts";
import { $page, ReactRouter, useQueryParams } from "../index.browser.ts";

describe("query-only navigation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("re-runs the loader when only the query changes", async () => {
    const seen: string[] = [];

    class App {
      search = $page({
        path: "/search",
        schema: {
          query: z.object({ q: z.string().optional() }),
        },
        loader: async ({ query }: { query: { q?: string } }) => {
          seen.push(query.q ?? "");
          return { q: query.q ?? "" };
        },
        component: () => <div>Search</div>,
      });
    }

    const alepha = Alepha.create().with(AlephaReact).with(App);
    await alepha.start();
    const router = alepha.inject(ReactRouter);

    await act(async () => {
      await router.push("/search?q=foo");
    });
    expect(seen).toEqual(["foo"]);

    // Same path, different query — the loader reads `query`, so reusing the
    // cached layer here leaves stale data on screen (and diverges from SSR,
    // which re-runs the loader for the same URL).
    await act(async () => {
      await router.push("/search?q=bar");
    });
    expect(seen).toEqual(["foo", "bar"]);
  });

  it("setQueryParams keeps router.query in sync", async () => {
    class App {
      home = $page({
        path: "/",
        component: () => <div>Home</div>,
      });
    }

    const alepha = Alepha.create().with(AlephaReact).with(App);
    await alepha.start();
    const router = alepha.inject(ReactRouter);

    await act(async () => {
      await router.push("/");
    });

    act(() => {
      router.setQueryParams({ tab: "security" });
    });

    // Both the URL and the router's own view of it must agree — two
    // components reading `router.query` desync otherwise.
    expect(window.location.search).toBe("?tab=security");
    expect(router.query.tab).toBe("security");
    // The history entry must keep the key the router stamped on it: scroll
    // restoration and canGoBack() read it back on popstate, and a bare
    // `replaceState({})` used to wipe it.
    expect(window.history.state).toEqual({ alephaKey: expect.any(Number) });
  });

  it("useQueryParams re-syncs when the router state changes", async () => {
    class App {
      home = $page({
        path: "/",
        component: () => <div>Home</div>,
      });
    }

    const alepha = Alepha.create().with(AlephaReact).with(App);
    await alepha.start();
    const router = alepha.inject(ReactRouter);

    await act(async () => {
      await router.push("/?tab=a");
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () =>
        useQueryParams(z.object({ tab: z.string().optional() }), {
          format: "querystring",
        }),
      { wrapper },
    );
    expect(result.current[0].tab).toBe("a");

    // A navigation the component did not initiate (back/forward, another
    // component's push) must still reach this hook.
    await act(async () => {
      await router.push("/?tab=b");
    });

    await waitFor(() => {
      expect(result.current[0].tab).toBe("b");
    });
  });
});
