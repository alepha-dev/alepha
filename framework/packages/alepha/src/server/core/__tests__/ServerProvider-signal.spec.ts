import { $inject, AbortedError, Alepha, z } from "alepha";
import { $route, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

/**
 * A request's ambient signal on node (#E85): aborted when the client goes
 * away before the response is complete, and only then.
 */
describe("ServerProvider request signal (node)", () => {
  const deferred = <T = void>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  it("aborts the request's signal when the client disconnects mid-handler", async ({
    expect,
  }) => {
    const started = deferred();
    const aborted = deferred<unknown>();
    let sameObject = false;

    class App {
      slow = $route({
        path: "/slow",
        handler: async ({ signal }) => {
          sameObject = signal === this.alepha.context.signal;
          started.resolve();
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          aborted.resolve(signal.reason);
          return "too late";
        },
      });
      alepha = $inject(Alepha);
    }

    const alepha = Alepha.create().with(App).with(AlephaServer);
    await alepha.start();
    const hostname = alepha.inject(ServerProvider).hostname;

    const client = new AbortController();
    const response = fetch(`${hostname}/slow`, { signal: client.signal });
    await started.promise;
    client.abort();
    await response.catch(() => undefined);

    const reason = await aborted.promise;
    expect(sameObject).toBe(true);
    expect(reason).toBeInstanceOf(AbortedError);
    expect(alepha.context.isAbortError(reason)).toBe(true);
  });

  it("leaves the signal alone once the response completed", async ({
    expect,
  }) => {
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

    const alepha = Alepha.create().with(App).with(AlephaServer);
    await alepha.start();
    const hostname = alepha.inject(ServerProvider).hostname;

    const res = await fetch(`${hostname}/quick`, {
      headers: { connection: "close" },
    });
    expect(await res.text()).toBe("done");
    // Give the socket time to close.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(captured?.aborted).toBe(false);
  });

  /**
   * Node emits `close` on `req` as soon as its body has been read, whether or
   * not the client is still there. Watching `req` would abort every POST the
   * moment the body parser finished.
   */
  it("does not abort once the request body has been consumed", async ({
    expect,
  }) => {
    let abortedDuringHandler: boolean | undefined;

    class App {
      post = $route({
        method: "POST",
        path: "/echo",
        schema: {
          body: z.object({ value: z.text() }),
        },
        handler: async ({ body, signal }) => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          abortedDuringHandler = signal.aborted;
          return body.value;
        },
      });
    }

    const alepha = Alepha.create().with(App).with(AlephaServer);
    await alepha.start();
    const hostname = alepha.inject(ServerProvider).hostname;

    const res = await fetch(`${hostname}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "still here" }),
    });

    expect(await res.text()).toBe("still here");
    expect(abortedDuringHandler).toBe(false);
  });
});
