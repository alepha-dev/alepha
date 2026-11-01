import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { act, Suspense, use } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { $page, ReactRouter } from "../index.browser.ts";
import {
  type DeferredPromise,
  ReactDeferred,
} from "../services/ReactDeferred.ts";

describe("ReactDeferred", () => {
  const deferred = new ReactDeferred();

  it("reads a settled payload value synchronously", () => {
    const layers = [
      {
        props: {
          kept: "plain",
          value: {
            $deferred: { status: "fulfilled", value: 1 },
            id: "1:value",
          },
        } as Record<string, unknown>,
      },
    ];

    deferred.revive(layers, {});

    const value = layers[0].props.value as DeferredPromise;
    expect(layers[0].props.kept).toBe("plain");
    expect(value.status).toBe("fulfilled");
    expect(value.value).toBe(1);
  });

  it("keeps an error's name, message and status", async () => {
    const layers = [
      {
        props: {
          value: {
            $deferred: {
              status: "rejected",
              error: { name: "NotFound", message: "gone", status: 404 },
            },
            id: "1:value",
          },
        } as Record<string, unknown>,
      },
    ];

    deferred.revive(layers, {});

    const value = layers[0].props.value as DeferredPromise;
    await expect(value).rejects.toMatchObject({
      name: "NotFound",
      message: "gone",
      status: 404,
    });
  });

  it("takes a value delivered before the entry booted", async () => {
    const target = {
      __alephaDeferred: [["1:value", { status: "fulfilled", value: 2 }]],
    };
    const layers = [
      {
        props: {
          value: { $deferred: { status: "pending" }, id: "1:value" },
        } as Record<string, unknown>,
      },
    ];

    deferred.revive(layers, target as never);

    await expect(layers[0].props.value).resolves.toBe(2);
  });

  it("takes a value delivered after the entry booted", async () => {
    const target: Record<string, any> = {};
    const layers = [
      {
        props: {
          value: { $deferred: { status: "pending" }, id: "1:value" },
        } as Record<string, unknown>,
      },
    ];

    deferred.revive(layers, target);
    const value = layers[0].props.value as DeferredPromise;
    expect(value.status).toBe("pending");

    target.__alephaDeferred.push([
      "1:value",
      { status: "fulfilled", value: 3 },
    ]);

    await expect(value).resolves.toBe(3);
    expect(value.status).toBe("fulfilled");
  });

  it("escapes a value that would close its script", () => {
    const promise = Promise.resolve() as DeferredPromise;
    promise.status = "fulfilled";
    promise.value = "</script><b>";

    expect(deferred.deliveryScript("1:value", promise)).not.toContain(
      "</script",
    );
  });

  it("describes a rejection in the payload, never as {}", () => {
    const promise = Promise.reject(new Error("nope")) as DeferredPromise;
    const props = { value: promise };
    deferred.track(props);
    promise.status = "rejected";
    promise.reason = new Error("nope");

    expect(deferred.serialize(props, 1)?.value).toEqual({
      $deferred: {
        status: "rejected",
        error: { name: "Error", message: "nope" },
      },
      id: "1:value",
    });
  });
});

describe("$page deferred values (client navigation)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  const text = () => document.getElementById("root")?.textContent;

  const Slow = (props: { value: Promise<string> }) => <b>{use(props.value)}</b>;

  it("renders at once, and fills in", async () => {
    let release = (_: string) => {};

    class App {
      a = $page({ path: "/a", component: () => <div>A</div> });

      b = $page({
        path: "/b",
        loader: async () => ({
          value: new Promise<string>((resolve) => {
            release = resolve;
          }),
        }),
        component: (props: { value: Promise<string> }) => (
          <main>
            Shell
            <Suspense fallback="Pending">
              <Slow value={props.value} />
            </Suspense>
          </main>
        ),
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

    await act(async () => {
      await router.push("/b");
    });
    expect(text()).toBe("ShellPending");

    await act(async () => {
      release("Done");
    });
    expect(text()).toBe("ShellDone");
  });

  it("reaches the page's errorHandler on a rejection", async () => {
    class App {
      a = $page({ path: "/a", component: () => <div>A</div> });

      b = $page({
        path: "/b",
        loader: async () => ({ value: Promise.reject(new Error("nope")) }),
        errorHandler: () => <div>Handled</div>,
        component: (props: { value: Promise<string> }) => (
          <main>
            <Slow value={props.value} />
          </main>
        ),
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
    await act(async () => {
      await router.push("/b");
    });

    expect(text()).toBe("Handled");
  });
});
