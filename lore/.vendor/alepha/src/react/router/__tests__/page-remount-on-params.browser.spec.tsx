import { Alepha, z } from "alepha";
import { AlephaReact } from "alepha/react";
import { act, useEffect, useState } from "react";
import { beforeEach, describe, it } from "vitest";

import { $page, NestedView, ReactRouter } from "../index.browser.ts";

/**
 * A `$page` remounts when its params change (#Q2349).
 *
 * The router used to key no layer, so a navigation from `/epics/51` to
 * `/epics/50` kept the mounted page and handed it new props: a component that
 * did `useState(props.epic)` went on showing Epic 51 under a breadcrumb that
 * said 50. Each layer is now keyed by its path compiled from the matched
 * params, the Next.js App Router's behaviour.
 */
describe("a $page and its params", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  const text = (testId: string) =>
    document.querySelector(`[data-testid="${testId}"]`)?.textContent;

  /**
   * Counts component INSTANCES, not effect runs: the root renders under
   * StrictMode, which runs every mount effect twice for one instance.
   */
  const useInstance = (seen: Set<object>) => {
    const [instance] = useState(() => ({}));
    useEffect(() => {
      seen.add(instance);
    }, [instance]);
  };

  const setup = async () => {
    const instances = {
      layout: new Set<object>(),
      epic: new Set<object>(),
      user: new Set<object>(),
    };
    const loads = { epic: 0, user: 0 };

    const Layout = () => {
      useInstance(instances.layout);
      return <NestedView />;
    };

    const Epic = (props: { epicNumber: number }) => {
      // Reads its argument once, at mount: the pattern that went stale.
      const [shown] = useState(props.epicNumber);
      useInstance(instances.epic);
      return <div data-testid="epic">{shown}</div>;
    };

    const User = (props: { id?: string }) => {
      useInstance(instances.user);
      return <div data-testid="user">{props.id ?? "?"}</div>;
    };

    class App {
      layout = $page({
        path: "/p",
        component: Layout,
      });

      epic = $page({
        parent: this.layout,
        path: "/epics/:epicNumber",
        schema: {
          params: z.object({ epicNumber: z.integer() }),
          query: z.object({ tab: z.string().optional() }),
        },
        loader: async ({ params }: { params: { epicNumber: number } }) => {
          loads.epic++;
          return { epicNumber: params.epicNumber };
        },
        component: Epic,
      });

      // No `schema.params`: its decoded params are `{}`.
      user = $page({
        parent: this.layout,
        path: "/users/:id",
        loader: async ({ url }: { url: URL }) => {
          loads.user++;
          return { id: url.pathname.split("/").pop() };
        },
        component: User,
      });
    }

    const alepha = Alepha.create().with(AlephaReact).with(App);
    await alepha.start();
    const router = alepha.inject(ReactRouter);
    const go = async (url: string) => {
      await act(async () => {
        await router.push(url);
      });
    };
    const mounts = {
      get layout() {
        return instances.layout.size;
      },
      get epic() {
        return instances.epic.size;
      },
      get user() {
        return instances.user.size;
      },
    };
    return { router, go, mounts, loads };
  };

  it("remounts the page on a param change, and keeps the layout above it", async ({
    expect,
  }) => {
    const { go, mounts } = await setup();

    await go("/p/epics/51");
    expect(text("epic")).toBe("51");

    await go("/p/epics/50");
    expect(text("epic")).toBe("50");
    expect(mounts.epic).toBe(2);
    expect(mounts.layout).toBe(1);
  });

  it("does not remount on a query-only change, and still re-runs the loader", async ({
    expect,
  }) => {
    const { go, mounts, loads } = await setup();

    await go("/p/epics/51?tab=a");
    await go("/p/epics/51?tab=b");

    expect(loads.epic).toBe(2);
    expect(mounts.epic).toBe(1);
  });

  it("does not remount on invalidate, which re-runs the loader", async ({
    expect,
  }) => {
    const { go, router, mounts, loads } = await setup();

    await go("/p/epics/51");
    await act(async () => {
      await router.invalidate();
    });

    expect(loads.epic).toBe(2);
    expect(mounts.epic).toBe(1);
    expect(mounts.layout).toBe(1);
  });

  /**
   * ⚠️ The trap the identity had to avoid: with no `schema.params`, the
   * decoded params are `{}` for every user, so a check on them reused the
   * layer and the second user's loader never ran.
   */
  it("remounts and reloads a page with no params schema", async ({
    expect,
  }) => {
    const { go, mounts, loads } = await setup();

    await go("/p/users/1");
    expect(text("user")).toBe("1");

    await go("/p/users/2");
    expect(text("user")).toBe("2");
    expect(loads.user).toBe(2);
    expect(mounts.user).toBe(2);
    expect(mounts.layout).toBe(1);
  });
});
