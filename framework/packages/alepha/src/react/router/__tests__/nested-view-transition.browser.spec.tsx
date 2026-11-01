import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { $page, ReactRouter } from "../index.browser.ts";
import type { ReactRouterState } from "../providers/ReactPageProvider.ts";
import { ReactViewTransition } from "../services/ReactViewTransition.ts";

class TestViewTransition extends ReactViewTransition {
  public reducedMotion = false;

  protected override get prefersReducedMotion() {
    return this.reducedMotion;
  }
}

describe("NestedView view transitions", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    delete (document as { fonts?: unknown }).fonts;
    delete (Element.prototype as { animate?: unknown }).animate;
    delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
  });

  const view = () =>
    document.querySelector<HTMLElement>('[data-testid="view"]');

  /**
   * A browser's `startViewTransition`, recording the class each view carries
   * when the old state is captured: that is what the old snapshot animates by.
   */
  const fakeViewTransitions = () => {
    const leaving: Array<string | undefined> = [];
    const started: number[] = [];
    (document as { fonts?: unknown }).fonts = { status: "loaded" };
    (Element.prototype as { animate?: unknown }).animate = () => ({
      cancel: () => {},
    });
    (Element.prototype as { getAnimations?: unknown }).getAnimations = () => [];
    (document as { startViewTransition?: unknown }).startViewTransition =
      (options: { update: () => Promise<void> | void }) => {
        started.push(1);
        leaving.push(
          (view()?.style as { viewTransitionClass?: string } | undefined)
            ?.viewTransitionClass,
        );
        const updated = Promise.resolve().then(() => options.update());
        return {
          ready: updated,
          finished: updated,
          updateCallbackDone: updated,
          skipTransition: () => {},
        };
      };
    return { leaving, started };
  };

  it("does not commit a view that a later navigation has superseded", async () => {
    class App {
      a = $page({
        path: "/a",
        viewTransition: "fade",
        component: () => <div data-testid="view">A</div>,
      });

      b = $page({
        path: "/b",
        loader: async () => {
          await new Promise((resolve) => setTimeout(resolve, 60));
          return {};
        },
        component: () => <div data-testid="view">B</div>,
      });

      c = $page({
        path: "/c",
        component: () => <div data-testid="view">C</div>,
      });
    }

    const alepha = Alepha.create().with(AlephaReact).with(App);
    await act(async () => {
      await alepha.start();
    });
    const router = alepha.inject(ReactRouter);

    await act(async () => {
      await router.push("/a");
    });
    expect(view()?.textContent).toBe("A");

    await act(async () => {
      // What a user double-clicking two links produces.
      const slow = router.push("/b");
      await new Promise((resolve) => setTimeout(resolve, 10));
      await router.push("/c");
      await slow;
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(view()?.textContent).toBe("C");
  });

  it("reports the commit with the new view already in the DOM", async () => {
    class App {
      a = $page({
        path: "/a",
        component: () => <div data-testid="view">A</div>,
      });

      b = $page({
        path: "/b",
        component: () => <div data-testid="view">B</div>,
      });
    }

    const alepha = Alepha.create().with(AlephaReact).with(App);
    const onScreen: Array<string | null | undefined> = [];
    alepha.events.on("react:transition:committed", () => {
      onScreen.push(view()?.textContent);
    });

    await act(async () => {
      await alepha.start();
    });
    const router = alepha.inject(ReactRouter);

    await act(async () => {
      await router.push("/a");
    });
    await act(async () => {
      await router.push("/b");
    });

    expect(onScreen).toEqual(["A", "B"]);
  });

  it("reports the commit of a navigation that reuses every layer", async () => {
    class App {
      a = $page({
        path: "/a",
        component: () => <div data-testid="view">A</div>,
      });
    }

    const alepha = Alepha.create().with(AlephaReact).with(App);
    const committed: string[] = [];
    alepha.events.on("react:transition:committed", ({ state }) => {
      committed.push(state.url.hash);
    });

    await act(async () => {
      await alepha.start();
    });
    const router = alepha.inject(ReactRouter);

    await act(async () => {
      await router.push("/a");
    });
    await act(async () => {
      await router.push("/a#section");
    });

    expect(committed).toEqual(["", "#section"]);
  });

  it("gives the leaving page the exit its function reads from the target", async () => {
    class App {
      a = $page({
        path: "/a",
        viewTransition: ({ url }) =>
          url.pathname === "/b" ? { exit: "to-b" } : undefined,
        component: () => <div data-testid="view">A</div>,
      });

      b = $page({
        path: "/b",
        component: () => <div data-testid="view">B</div>,
      });

      c = $page({
        path: "/c",
        component: () => <div data-testid="view">C</div>,
      });
    }

    const alepha = Alepha.create().with(AlephaReact).with(App);
    await act(async () => {
      await alepha.start();
    });
    const router = alepha.inject(ReactRouter);

    await act(async () => {
      await router.push("/a");
    });

    const { leaving } = fakeViewTransitions();

    await act(async () => {
      await router.push("/b");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(view()?.textContent).toBe("B");
    expect(leaving[0]).toBe("to-b");
  });

  it("starts no view transition for pages that ask for none", async () => {
    class App {
      a = $page({
        path: "/a",
        component: () => <div data-testid="view">A</div>,
      });

      b = $page({
        path: "/b",
        component: () => <div data-testid="view">B</div>,
      });
    }

    const alepha = Alepha.create().with(AlephaReact).with(App);
    await act(async () => {
      await alepha.start();
    });
    const router = alepha.inject(ReactRouter);

    await act(async () => {
      await router.push("/a");
    });

    const { started } = fakeViewTransitions();

    await act(async () => {
      await router.push("/b");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(view()?.textContent).toBe("B");
    expect(started).toEqual([]);
  });
});

describe("ReactViewTransition", () => {
  const target = {
    url: new URL("http://localhost/b"),
    meta: {},
  } as ReactRouterState;

  const service = () =>
    Alepha.create()
      .with({ provide: ReactViewTransition, use: TestViewTransition })
      .inject(TestViewTransition);

  it("reads a string as enter and exit, never update", ({ expect }) => {
    expect(service().resolve("fade", target)).toEqual({
      enter: "fade",
      exit: "fade",
    });
  });

  it("calls a function with the target", ({ expect }) => {
    const resolved = service().resolve(
      ({ url }) => (url.pathname === "/b" ? { update: "pulse" } : undefined),
      target,
    );

    expect(resolved).toEqual({ update: "pulse" });
  });

  it("asks for nothing when a function returns nothing", ({ expect }) => {
    expect(service().resolve(() => undefined, target)).toEqual({});
  });

  it("is off under prefers-reduced-motion", ({ expect }) => {
    const transition = service();
    transition.reducedMotion = true;

    expect(transition.resolve("fade", target)).toEqual({});
  });

  it("is off for a back gesture the browser already animated", ({ expect }) => {
    const transition = service();
    transition.browserAnimated = true;

    expect(transition.resolve("fade", target)).toEqual({});
  });
});
