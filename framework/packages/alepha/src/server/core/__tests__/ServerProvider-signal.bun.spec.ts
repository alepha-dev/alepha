import { afterEach, describe, expect, it } from "bun:test";

import { $inject, Alepha } from "alepha";

import { $route, ServerProvider } from "../index.ts";

/**
 * A request's ambient signal on bun (#E85): bun aborts `request.signal` when
 * the client goes away, and the request context carries that signal.
 */
describe("ServerProvider request signal (bun)", () => {
  let alepha: Alepha;

  afterEach(async () => {
    await alepha?.stop().catch(() => {});
  });

  it("aborts the request's signal when the client disconnects mid-handler", async () => {
    let onStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      onStarted = resolve;
    });
    let onAborted!: () => void;
    const aborted = new Promise<void>((resolve) => {
      onAborted = resolve;
    });
    let sameObject = false;

    class App {
      alepha = $inject(Alepha);
      slow = $route({
        path: "/slow",
        handler: async ({ signal }) => {
          sameObject = signal === this.alepha.context.signal;
          onStarted();
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          onAborted();
          return "too late";
        },
      });
    }

    alepha = Alepha.create({ env: { NODE_ENV: "test" } });
    await alepha.with(App).start();
    const hostname = alepha.inject(ServerProvider).hostname;

    const client = new AbortController();
    const response = fetch(`${hostname}/slow`, { signal: client.signal });
    await started;
    client.abort();
    await response.catch(() => undefined);
    await aborted;

    expect(sameObject).toBe(true);
  });

  it("leaves the signal alone once the response completed", async () => {
    let captured: AbortSignal | undefined;

    class App {
      quick = $route({
        path: "/quick",
        handler: ({ signal }) => {
          captured = signal;
          return "done";
        },
      });
    }

    alepha = Alepha.create({ env: { NODE_ENV: "test" } });
    await alepha.with(App).start();
    const hostname = alepha.inject(ServerProvider).hostname;

    const res = await fetch(`${hostname}/quick`);
    expect(await res.text()).toBe("done");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(captured?.aborted).toBe(false);
  });
});
