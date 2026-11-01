import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { act, use } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  $page,
  NestedView,
  ReactRouter,
  reactPageOptions,
} from "../index.browser.ts";

describe("$page loading", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  const DELAY = 30;

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const text = () => document.getElementById("root")?.textContent;

  const start = async (App: new () => object) => {
    const alepha = Alepha.create().with(AlephaReact).with(App);
    alepha.store.mut(reactPageOptions, (it) => ({
      ...it,
      loadingDelay: DELAY,
    }));
    await act(async () => {
      await alepha.start();
    });
    return { alepha, router: alepha.inject(ReactRouter) };
  };

  it("shows nothing for a navigation faster than the delay", async () => {
    const seen: Array<string | null | undefined> = [];

    class App {
      a = $page({ path: "/a", component: () => <div>A</div> });

      b = $page({
        path: "/b",
        loading: () => <div>Loading</div>,
        component: () => <div>B</div>,
      });
    }

    const { alepha, router } = await start(App);
    await act(async () => {
      await router.push("/a");
    });

    alepha.events.on("react:transition:end", () => {
      seen.push(text());
    });

    await act(async () => {
      await router.push("/b");
      await sleep(DELAY * 2);
    });

    expect(seen).toEqual(["A"]);
    expect(text()).toBe("B");
  });

  it("shows the page's loading in its slot, keeping the layout", async () => {
    let release = () => {};

    class App {
      layout = $page({
        component: () => (
          <div>
            Layout:
            <NestedView />
          </div>
        ),
      });

      a = $page({
        parent: this.layout,
        path: "/a",
        component: () => <div>A</div>,
      });

      b = $page({
        parent: this.layout,
        path: "/b",
        loading: () => <div>Loading</div>,
        loader: async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return {};
        },
        component: () => <div>B</div>,
      });
    }

    const { router } = await start(App);
    await act(async () => {
      await router.push("/a");
    });

    let navigation: Promise<void> = Promise.resolve();
    await act(async () => {
      navigation = router.push("/b");
      await sleep(DELAY * 2);
    });

    expect(text()).toBe("Layout:Loading");
    // The URL does not move early.
    expect(window.location.pathname).toBe("/a");

    await act(async () => {
      release();
      await navigation;
      await sleep(0);
    });

    expect(text()).toBe("Layout:B");
    expect(window.location.pathname).toBe("/b");
  });

  it("falls back to the nearest parent's loading", async () => {
    let release = () => {};

    class App {
      layout = $page({
        loading: () => <div>Parent loading</div>,
        component: () => <NestedView />,
      });

      a = $page({
        parent: this.layout,
        path: "/a",
        component: () => <div>A</div>,
      });

      b = $page({
        parent: this.layout,
        path: "/b",
        loader: async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return {};
        },
        component: () => <div>B</div>,
      });
    }

    const { router } = await start(App);
    await act(async () => {
      await router.push("/a");
    });

    let navigation: Promise<void> = Promise.resolve();
    await act(async () => {
      navigation = router.push("/b");
      await sleep(DELAY * 2);
    });
    expect(text()).toBe("Parent loading");

    await act(async () => {
      release();
      await navigation;
      await sleep(0);
    });
    expect(text()).toBe("B");
  });

  it("keeps the page on a query change", async () => {
    let release = () => {};
    let calls = 0;

    class App {
      a = $page({
        path: "/a",
        loading: () => <div>Loading</div>,
        loader: async () => {
          calls += 1;
          if (calls > 1) {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          return {};
        },
        component: () => <div>A</div>,
      });
    }

    const { router } = await start(App);
    await act(async () => {
      await router.push("/a");
    });

    let navigation: Promise<void> = Promise.resolve();
    await act(async () => {
      navigation = router.push("/a?q=1");
      await sleep(DELAY * 2);
    });
    expect(text()).toBe("A");

    await act(async () => {
      release();
      await navigation;
      await sleep(0);
    });
    expect(text()).toBe("A");
  });

  it("restores the page when the navigation is abandoned", async () => {
    // `react:transition:end` skips the view when the layer is reused, so the
    // skeleton has to come off on its own or it stays forever.
    class App {
      a = $page({ path: "/a", component: () => <div>A</div> });

      b = $page({
        path: "/b",
        loading: () => <div>Loading</div>,
        loader: async () => {
          await new Promise(() => {});
          return {};
        },
        component: () => <div>B</div>,
      });
    }

    const { router } = await start(App);
    await act(async () => {
      await router.push("/a");
    });

    await act(async () => {
      void router.push("/b");
      await sleep(DELAY * 2);
    });
    expect(text()).toBe("Loading");

    await act(async () => {
      await router.push("/a");
      await sleep(0);
    });
    expect(text()).toBe("A");
  });

  it("undoes the skeleton when the loader fails", async () => {
    class App {
      a = $page({ path: "/a", component: () => <div>A</div> });

      b = $page({
        path: "/b",
        loading: () => <div>Loading</div>,
        loader: async () => {
          await sleep(DELAY * 2);
          throw new Error("nope");
        },
        errorHandler: () => <div>Failed</div>,
        component: () => <div>B</div>,
      });
    }

    const { router } = await start(App);
    await act(async () => {
      await router.push("/a");
    });
    await act(async () => {
      await router.push("/b");
      await sleep(0);
    });

    expect(text()).toBe("Failed");
  });

  it("undoes the skeleton through a redirect", async () => {
    class App {
      a = $page({ path: "/a", component: () => <div>A</div> });

      b = $page({ path: "/b", redirect: "/c" });

      c = $page({
        path: "/c",
        loader: async () => {
          await sleep(DELAY * 2);
          return {};
        },
        loading: () => <div>Loading</div>,
        component: () => <div>C</div>,
      });
    }

    const { router } = await start(App);
    await act(async () => {
      await router.push("/a");
    });
    await act(async () => {
      await router.push("/b");
      await sleep(0);
    });

    expect(text()).toBe("C");
  });

  it("is the page's Suspense boundary", async () => {
    const value = new Promise<string>(() => {});
    const Pending = () => <div>{use(value)}</div>;

    class App {
      a = $page({ path: "/a", component: () => <div>A</div> });

      b = $page({
        path: "/b",
        loading: () => <div>Loading</div>,
        component: Pending,
      });
    }

    const { router } = await start(App);
    await act(async () => {
      await router.push("/a");
    });
    await act(async () => {
      await router.push("/b");
      await sleep(0);
    });

    expect(text()).toBe("Loading");
  });
});
