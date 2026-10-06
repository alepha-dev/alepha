import { $hook, $inject, Alepha, type Service } from "alepha";
import { AlephaReact } from "alepha/react";
import { HttpError } from "alepha/server";
import { act, use } from "react";
import { beforeEach, describe, it } from "vitest";

import {
  $page,
  ReactBrowserProvider,
  ReactBootHealth,
  type ReactBootOutcome,
  reactBootOptions,
} from "../index.browser.ts";

/**
 * Everything a boot told the outside world: the settled outcomes, in order,
 * and whether a `ready` hook ordered after the router's ran.
 */
class BootProbe {
  public outcomes: ReactBootOutcome[] = [];
  public laterReady = false;

  protected readonly onSettled = $hook({
    on: "react:boot:settled",
    handler: ({ outcome }) => {
      this.outcomes.push(outcome);
    },
  });

  protected readonly onReady = $hook({
    on: "ready",
    priority: "last",
    handler: () => {
      this.laterReady = true;
    },
  });
}

const text = () => document.getElementById("root")?.textContent ?? "";

const flush = () => act(async () => {});

/**
 * Boot an app the way a browser does, client-rendered (no SSR payload).
 */
const boot = async (
  App: Service,
  opts: { offline?: boolean; deadline?: number } = {},
) => {
  const alepha = Alepha.create().with(AlephaReact).with(App).with(BootProbe);
  if (opts.offline) {
    alepha.store.set(reactBootOptions, {
      offline: true,
      deadline: opts.deadline ?? 100,
    });
  }
  await act(async () => {
    await alepha.start();
  });
  await flush();
  return {
    alepha,
    probe: alepha.inject(BootProbe),
    health: alepha.inject(ReactBootHealth),
  };
};

describe("boot health", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("is healthy once the page is on the screen, and says so once", async ({
    expect,
  }) => {
    // The root renders under StrictMode, which runs the marker's effect twice.
    class App {
      home = $page({ path: "/", component: () => <p>home</p> });
    }

    const { probe, health } = await boot(App);

    expect(text()).toBe("home");
    expect(probe.outcomes).toEqual(["healthy"]);
    expect(await health.settled()).toBe("healthy");
  });

  it("fails when the page component throws", async ({ expect }) => {
    const Broken = () => {
      throw new Error("render broke");
    };
    class App {
      home = $page({ path: "/", component: Broken });
    }

    const { probe } = await boot(App);

    expect(probe.outcomes).toEqual(["failed"]);
  });

  it("fails on a loader error layer", async ({ expect }) => {
    class App {
      home = $page({
        path: "/",
        loader: async () => {
          throw new Error("loader broke");
        },
        component: () => <p>never</p>,
      });
    }

    const { probe } = await boot(App);

    expect(probe.outcomes).toEqual(["failed"]);
  });

  it("waits for a suspended first tree before saying anything", async ({
    expect,
  }) => {
    // The router renders no loading fallback of its own: a page that suspends
    // holds the whole first screen, and the marker with it, until it resolves.
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((r) => {
      resolve = r;
    });
    const Slow = () => <p>{use(pending)}</p>;
    class App {
      home = $page({ path: "/", component: Slow });
    }

    const { probe } = await boot(App);
    expect(probe.outcomes).toEqual([]);

    await act(async () => {
      resolve("ready");
    });

    expect(text()).toBe("ready");
    expect(probe.outcomes).toEqual(["healthy"]);
  });

  describe("with the offline option", () => {
    it("commits the offline screen when the first loader never settles, within the deadline", async ({
      expect,
    }) => {
      let release!: () => void;
      class App {
        home = $page({
          path: "/",
          loader: () =>
            new Promise<{ name: string }>((r) => {
              release = () => r({ name: "late" });
            }),
          component: (props: { name: string }) => <p>{props.name}</p>,
        });
      }

      // `start` resolving at all is the point: without the option, a loader
      // that never settles holds `ready` and `start` forever.
      const { probe } = await boot(App, { offline: true, deadline: 100 });

      expect(document.querySelector("[data-alepha-offline]")).not.toBeNull();
      expect(probe.outcomes).toEqual(["healthy"]);
      expect(probe.laterReady).toBe(true);

      // The superseded transition finishing late changes nothing.
      await act(async () => {
        release();
      });
      expect(document.querySelector("[data-alepha-offline]")).not.toBeNull();
      expect(probe.outcomes).toEqual(["healthy"]);
    });

    it("commits the offline screen when a request gets no response, and retry recovers", async ({
      expect,
    }) => {
      let reachable = false;
      class App {
        home = $page({
          path: "/",
          loader: async () => {
            if (!reachable) {
              throw new TypeError("Failed to fetch");
            }
            return { name: "back online" };
          },
          component: (props: { name: string }) => <p>{props.name}</p>,
        });
      }

      const { probe } = await boot(App, { offline: true });

      expect(
        document
          .querySelector("[data-alepha-offline]")
          ?.getAttribute("data-alepha-offline"),
      ).toBe("network");
      expect(probe.outcomes).toEqual(["healthy"]);

      reachable = true;
      await act(async () => {
        document
          .querySelector<HTMLButtonElement>("[data-alepha-offline] button")
          ?.click();
      });
      await flush();

      expect(text()).toBe("back online");
    });

    it("boots again for a URL pushed from the offline screen, boot tasks first", async ({
      expect,
    }) => {
      let reachable = false;
      let user: string | undefined;
      class App {
        protected readonly health = $inject(ReactBootHealth);

        protected readonly onConfigure = $hook({
          on: "configure",
          handler: () => {
            // A session restore: what a page past the offline screen relies on.
            this.health.addBootTask(async () => {
              if (!reachable) {
                throw new TypeError("Failed to fetch");
              }
              user = "alice";
            });
          },
        });

        home = $page({
          path: "/",
          component: () => <p>home</p>,
        });

        notes = $page({
          path: "/notes",
          loader: async () => ({ owner: user ?? "nobody" }),
          component: (props: { owner: string }) => (
            <p>notes of {props.owner}</p>
          ),
        });
      }

      const { alepha } = await boot(App, { offline: true });
      expect(document.querySelector("[data-alepha-offline]")).not.toBeNull();
      const router = alepha.inject(ReactBrowserProvider);

      // Still unreachable: the offline screen again, now for the pushed URL.
      await act(async () => {
        await router.push("/notes");
      });
      await flush();
      expect(document.querySelector("[data-alepha-offline]")).not.toBeNull();
      expect(window.location.pathname).toBe("/notes");

      reachable = true;
      await act(async () => {
        await router.push("/notes");
      });
      await flush();

      expect(text()).toBe("notes of alice");
      expect(window.location.pathname).toBe("/notes");
    });

    it("keeps an HTTP error an error, not offline", async ({ expect }) => {
      class App {
        home = $page({
          path: "/",
          loader: async () => {
            throw new HttpError({ status: 500, message: "boom" });
          },
          component: () => <p>never</p>,
        });
      }

      const { probe } = await boot(App, { offline: true });

      expect(document.querySelector("[data-alepha-offline]")).toBeNull();
      expect(probe.outcomes).toEqual(["failed"]);
    });
  });

  it("without the option, a request with no response is the ordinary error layer", async ({
    expect,
  }) => {
    class App {
      home = $page({
        path: "/",
        loader: async () => {
          throw new TypeError("Failed to fetch");
        },
        component: () => <p>never</p>,
      });
    }

    const { probe } = await boot(App);

    expect(document.querySelector("[data-alepha-offline]")).toBeNull();
    expect(probe.outcomes).toEqual(["failed"]);
  });
});
