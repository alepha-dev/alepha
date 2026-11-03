import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { $page, Link, ReactRouter } from "../index.browser.ts";

describe("Link prefetching", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    Object.defineProperty(navigator, "connection", {
      value: undefined,
      configurable: true,
    });
    delete (window as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  const wait = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const hover = (element: Element | null | undefined) => {
    element?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  };

  const start = async () => {
    const loaded: string[] = [];
    const chunk =
      (name: string, fail = false) =>
      async () => {
        loaded.push(name);
        if (fail) {
          throw new Error("Failed to fetch dynamically imported module");
        }
        return { default: () => <div>{name}</div> };
      };

    class App {
      home = $page({
        path: "/",
        component: () => (
          <main>
            <Link href="/section/page" prefetch="hover" data-testid="hover" />
            <Link href="/broken" prefetch="hover" data-testid="broken" />
            <Link href="/section/other" prefetch="visible" data-testid="seen" />
            <Link href="/plain" data-testid="plain" />
            <span data-testid="elsewhere" />
          </main>
        ),
      });

      section = $page({ path: "/section", lazy: chunk("section") });

      page = $page({
        parent: this.section,
        path: "/page",
        lazy: chunk("page"),
      });

      other = $page({
        parent: this.section,
        path: "/other",
        lazy: chunk("other"),
      });

      plain = $page({ path: "/plain", lazy: chunk("plain") });

      broken = $page({ path: "/broken", lazy: chunk("broken", true) });
    }

    const alepha = Alepha.create().with(AlephaReact).with(App);
    await act(async () => {
      await alepha.start();
    });
    const router = alepha.inject(ReactRouter);
    const link = (id: string) =>
      document.querySelector(`[data-testid="${id}"]`);

    return { loaded, router, link };
  };

  it("sets the attribute, and only that", async () => {
    const { link } = await start();

    expect(link("hover")?.getAttribute("data-prefetch")).toBe("hover");
    expect(link("plain")?.hasAttribute("data-prefetch")).toBe(false);
    expect(link("hover")?.hasAttribute("prefetch")).toBe(false);
  });

  it("fetches the page and its layouts after 100 ms of hover", async () => {
    const { loaded, link } = await start();

    hover(link("hover"));
    expect(loaded).toEqual([]);

    await wait(150);
    expect([...loaded].sort()).toEqual(["page", "section"]);
  });

  it("does nothing when the pointer leaves first", async () => {
    const { loaded, link } = await start();

    hover(link("hover"));
    hover(link("elsewhere"));
    await wait(150);

    expect(loaded).toEqual([]);
  });

  it("does nothing on a plain link", async () => {
    const { loaded, link } = await start();

    hover(link("plain"));
    await wait(150);

    expect(loaded).toEqual([]);
  });

  it("fetches each chunk once", async () => {
    const { loaded, link } = await start();

    hover(link("hover"));
    await wait(150);
    hover(link("elsewhere"));
    hover(link("hover"));
    await wait(150);

    expect(loaded).toHaveLength(2);
  });

  it("reaches a chunk by name, through the router", async () => {
    const { loaded, router } = await start();

    (router as ReactRouter<any>).prefetch("page");
    await wait(10);

    expect([...loaded].sort()).toEqual(["page", "section"]);
  });

  it("ignores a URL no page answers", async () => {
    const { loaded, router } = await start();

    (router as ReactRouter<any>).prefetch("/no/such/page");
    await wait(10);

    expect(loaded).toEqual([]);
  });

  it("keeps at most 4 chunks in flight", async () => {
    let running = 0;
    let peak = 0;
    let done = 0;
    const slow = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await wait(5);
      running -= 1;
      done += 1;
      return { default: () => <div /> };
    };

    class App {
      a = $page({ path: "/a", lazy: () => slow() });
      b = $page({ path: "/b", lazy: () => slow() });
      c = $page({ path: "/c", lazy: () => slow() });
      d = $page({ path: "/d", lazy: () => slow() });
      e = $page({ path: "/e", lazy: () => slow() });
      f = $page({ path: "/f", lazy: () => slow() });
    }

    const alepha = Alepha.create().with(AlephaReact).with(App);
    await act(async () => {
      await alepha.start();
    });
    const router = alepha.inject(ReactRouter) as ReactRouter<any>;

    for (const path of ["/a", "/b", "/c", "/d", "/e", "/f"] as const) {
      router.prefetch(path);
    }
    await wait(50);

    expect(peak).toBe(4);
    expect(done).toBe(6);
  });

  it("is off under saveData", async () => {
    const { loaded, link } = await start();
    Object.defineProperty(navigator, "connection", {
      value: { saveData: true },
      configurable: true,
    });

    hover(link("hover"));
    await wait(150);

    expect(loaded).toEqual([]);
  });

  it("swallows a failure, with no reload and no rejection", async () => {
    const { loaded, link } = await start();
    const url = window.location.href;

    hover(link("broken"));
    await wait(150);

    expect(loaded).toEqual(["broken"]);
    expect(window.location.href).toBe(url);
    expect(sessionStorage.getItem("alepha:chunk-reload")).toBeNull();
  });

  it("fetches a visible link through one shared observer", async () => {
    let observers = 0;
    const seen: Element[] = [];
    let notify: (entries: unknown[]) => void = () => {};
    (window as { IntersectionObserver?: unknown }).IntersectionObserver =
      class {
        public constructor(callback: (entries: unknown[]) => void) {
          observers += 1;
          notify = callback;
        }
        public observe(element: Element) {
          seen.push(element);
        }
        public unobserve() {}
        public disconnect() {}
      };

    const { loaded, link } = await start();

    expect(observers).toBe(1);
    expect(seen).toContain(link("seen"));

    notify([{ isIntersecting: true, target: link("seen") }]);
    await wait(10);

    expect([...loaded].sort()).toEqual(["other", "section"]);
  });
});
