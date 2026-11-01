import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaReact } from "alepha/react";
import { $secure } from "alepha/security";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { $page, ReactRouter } from "../index.browser.ts";

describe("$page prefetch", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    Object.defineProperty(navigator, "connection", {
      value: undefined,
      configurable: true,
    });
  });

  const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

  const text = () => document.getElementById("root")?.textContent;

  const setup = async () => {
    const calls: string[] = [];

    class App {
      home = $page({ path: "/", component: () => <div>Home</div> });

      pure = $page({
        path: "/pure",
        prefetch: true,
        schema: { query: z.object({ q: z.text().optional() }) },
        loader: async ({ url }) => {
          calls.push(`pure${url.search}`);
          return { value: "Loaded" };
        },
        component: (props: { value: string }) => <div>{props.value}</div>,
      });

      writes = $page({
        path: "/writes",
        loader: async () => {
          calls.push("writes");
          return {};
        },
        component: () => <div>Writes</div>,
      });

      layout = $page({
        path: "/section",
        loader: async () => {
          calls.push("layout");
          return {};
        },
        component: () => <div>Section</div>,
      });

      child = $page({
        parent: this.layout,
        path: "/child",
        prefetch: true,
        loader: async () => {
          calls.push("child");
          return {};
        },
        component: () => <div>Child</div>,
      });

      refused = $page({
        path: "/refused",
        prefetch: true,
        loader: async () => {
          calls.push("refused");
          throw new Error("nope");
        },
        errorHandler: () => <div>Refused</div>,
        component: () => <div>Never</div>,
      });

      a = $page({
        path: "/a/:id",
        prefetch: true,
        loader: async ({ url }) => {
          calls.push(url.pathname);
          return {};
        },
        component: () => <div>A</div>,
      });
    }

    const alepha = Alepha.create().with(AlephaReact).with(App);
    await act(async () => {
      await alepha.start();
    });
    const router = alepha.inject(ReactRouter) as ReactRouter<any>;
    await act(async () => {
      await router.push("/");
    });
    return { alepha, router, calls };
  };

  it("runs an opted-in loader once, and the click uses the result", async () => {
    const { router, calls } = await setup();

    router.prefetch("/pure");
    await wait();
    expect(calls).toEqual(["pure"]);

    await act(async () => {
      await router.push("/pure");
    });

    expect(calls).toEqual(["pure"]);
    expect(text()).toBe("Loaded");
  });

  it("uses a result once", async () => {
    const { router, calls } = await setup();

    router.prefetch("/pure");
    await wait();
    await act(async () => {
      await router.push("/pure");
    });
    await act(async () => {
      await router.push("/");
    });
    await act(async () => {
      await router.push("/pure");
    });

    expect(calls).toEqual(["pure", "pure"]);
  });

  it("never runs a loader that did not opt in", async () => {
    const { router, calls } = await setup();

    router.prefetch("/writes");
    await wait();

    expect(calls).toEqual([]);
  });

  it("runs nothing when a parent to run did not opt in", async () => {
    const { router, calls } = await setup();

    router.prefetch("/section/child");
    await wait();

    expect(calls).toEqual([]);
  });

  it("runs a child alone when its parent is reused", async () => {
    const { router, calls } = await setup();
    await act(async () => {
      await router.push("/section");
    });
    calls.length = 0;

    router.prefetch("/section/child");
    await wait();

    expect(calls).toEqual(["child"]);
  });

  it("keys by the query", async () => {
    const { router, calls } = await setup();

    router.prefetch("/pure");
    await wait();
    await act(async () => {
      await router.push("/pure?q=1");
    });

    expect(calls).toEqual(["pure", "pure?q=1"]);
  });

  it("drops a failure, and the click does the work", async () => {
    const { router, calls } = await setup();

    router.prefetch("/refused");
    await wait();
    await act(async () => {
      await router.push("/refused");
    });

    expect(calls).toEqual(["refused", "refused"]);
    expect(text()).toBe("Refused");
  });

  it("forgets a result after 30 seconds", async () => {
    const { alepha, router, calls } = await setup();
    const dateTime = alepha.inject(DateTimeProvider);

    router.prefetch("/pure");
    await wait();
    await dateTime.travel([31, "seconds"]);
    await act(async () => {
      await router.push("/pure");
    });

    expect(calls).toEqual(["pure", "pure"]);
  });

  it("keeps at most 8 results", async () => {
    const { router, calls } = await setup();

    for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      router.prefetch(`/a/${id}`);
      await wait(2);
    }
    calls.length = 0;

    await act(async () => {
      await router.push("/a/1");
    });
    await act(async () => {
      await router.push("/a/9");
    });

    expect(calls).toEqual(["/a/1"]);
  });

  it("does nothing under saveData", async () => {
    const { router, calls } = await setup();
    Object.defineProperty(navigator, "connection", {
      value: { saveData: true },
      configurable: true,
    });

    router.prefetch("/pure");
    await wait();

    expect(calls).toEqual([]);
  });

  it("aborts when its link leaves the page, and keeps nothing", async () => {
    let signal: AbortSignal | undefined;
    let release = () => {};
    let runs = 0;

    class App {
      home = $page({ path: "/", component: () => <div>Home</div> });

      slow = $page({
        path: "/slow",
        prefetch: true,
        loader: async (context) => {
          runs += 1;
          signal = (context as { signal?: AbortSignal }).signal;
          if (runs === 1) {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          return { value: runs };
        },
        component: (props: { value: number }) => <div>Run {props.value}</div>,
      });
    }

    const alepha = Alepha.create().with(AlephaReact).with(App);
    await act(async () => {
      await alepha.start();
    });
    const router = alepha.inject(ReactRouter) as ReactRouter<any>;
    await act(async () => {
      await router.push("/");
    });

    const link = document.createElement("a");
    link.href = "/slow";
    link.dataset.prefetch = "hover";
    document.body.appendChild(link);
    link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await wait(150);
    expect(signal?.aborted).toBe(false);

    link.remove();
    await wait();
    expect(signal?.aborted).toBe(true);

    release();
    await wait();
    await act(async () => {
      await router.push("/slow");
    });

    expect(text()).toBe("Run 2");
  });

  it("runs a guard, and drops a denial", async () => {
    const calls: string[] = [];

    class App {
      home = $page({ path: "/", component: () => <div>Home</div> });

      guarded = $page({
        path: "/guarded",
        prefetch: true,
        use: [$secure()],
        loader: async () => {
          calls.push("guarded");
          return {};
        },
        component: () => <div>Guarded</div>,
      });
    }

    const alepha = Alepha.create().with(AlephaReact).with(App);
    await act(async () => {
      await alepha.start();
    });
    const router = alepha.inject(ReactRouter) as ReactRouter<any>;
    await act(async () => {
      await router.push("/");
    });

    router.prefetch("/guarded");
    await wait();

    expect(calls).toEqual([]);
    expect(text()).toBe("Home");
  });

  it("does not stand in for an invalidation", async () => {
    const { router, calls } = await setup();
    await act(async () => {
      await router.push("/pure");
    });
    await act(async () => {
      await router.push("/");
    });
    calls.length = 0;

    router.prefetch("/pure");
    await wait();
    await act(async () => {
      await router.push("/pure", { force: true });
    });

    expect(calls).toEqual(["pure", "pure"]);
  });
});
