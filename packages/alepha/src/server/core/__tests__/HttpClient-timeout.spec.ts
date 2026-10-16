import { $inject, Alepha, TimeoutError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import {
  $action,
  $route,
  AlephaServer,
  HttpClient,
  httpClientOptions,
  ServerProvider,
} from "../index.ts";

/**
 * A timeout on outbound calls (#E87): per call, else 30 s by default on the
 * server, never for the app's own actions.
 */
describe("HttpClient timeout", () => {
  /**
   * An upstream that never answers: `/hang` holds its response, `/stall`
   * sends its headers and a first chunk, then holds its body. Each reports
   * when it is hit and when its client leaves.
   */
  class Upstream {
    hit?: () => void;
    left?: () => void;

    hang = $route({
      path: "/hang",
      handler: async ({ signal }) => {
        this.hit?.();
        await new Promise((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
        this.left?.();
        return "late";
      },
    });

    stall = $route({
      path: "/stall",
      handler: async ({ signal, reply }) => {
        this.hit?.();
        signal.addEventListener("abort", () => this.left?.(), { once: true });
        // JSON, so the client reads the body rather than handing it back
        // as a lazy file.
        reply.headers["content-type"] = "application/json";
        return new ReadableStream<Uint8Array>({
          start: (controller) => {
            controller.enqueue(new TextEncoder().encode('{"partial":'));
          },
        });
      },
    });

    action = $action({
      method: "GET",
      path: "/action",
      handler: async () => {
        this.hit?.();
        await new Promise(() => {});
        return "never";
      },
    });
  }

  class Caller {
    http = $inject(HttpClient);
    server = $inject(ServerProvider);
    url(path: string) {
      return `${this.server.hostname}${path}`;
    }
  }

  const start = async (configure?: (alepha: Alepha) => void) => {
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(Upstream)
      .with(Caller);
    configure?.(alepha);
    await alepha.start();
    const upstream = alepha.inject(Upstream);
    const caller = alepha.inject(Caller);
    const time = alepha.inject(DateTimeProvider);
    time.pause();
    /**
     * Start `call`, wait until the upstream is hit (and the call has had a
     * moment to read the headers), then travel.
     */
    const past = async <T>(call: () => Promise<T>, travel: number) => {
      const hit = new Promise<void>((resolve) => {
        upstream.hit = resolve;
      });
      const left = new Promise<void>((resolve) => {
        upstream.left = resolve;
      });
      let settled = false;
      const pending = call().then(
        (value) => {
          settled = true;
          return value;
        },
        (error: unknown) => {
          settled = true;
          return error;
        },
      );
      await hit;
      await new Promise((r) => setTimeout(r, 30));
      await time.travel(travel);
      await new Promise((r) => setTimeout(r, 10));
      return { pending, left, settled: () => settled };
    };
    return { alepha, upstream, caller, time, past };
  };

  it("rejects with the TimeoutError and aborts the upstream call", async ({
    expect,
  }) => {
    const { caller, past } = await start();

    const { pending, left } = await past(
      () => caller.http.fetch(caller.url("/hang"), { timeout: [2, "seconds"] }),
      2_000,
    );

    const error = await pending;
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).data.timeout).toBe(2_000);
    await left;
  });

  it("covers the body: headers then a stalled body still time out", async ({
    expect,
  }) => {
    const { caller, past } = await start();

    const { pending } = await past(
      () =>
        caller.http.fetch(caller.url("/stall"), { timeout: [2, "seconds"] }),
      2_000,
    );

    expect(await pending).toBeInstanceOf(TimeoutError);
  });

  it("defaults to 30 seconds on the server", async ({ expect }) => {
    const { caller, time, past } = await start();

    const call = await past(
      () => caller.http.fetch(caller.url("/hang")),
      29_000,
    );
    expect(call.settled()).toBe(false);
    await time.travel(1_000);

    const error = await call.pending;
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).data.timeout).toBe(30_000);
  });

  it("lets a call opt out with timeout: false", async ({ expect }) => {
    const { caller, past } = await start();
    const stop = new AbortController();

    const call = await past(
      () =>
        caller.http.fetch(caller.url("/hang"), {
          timeout: false,
          signal: stop.signal,
        }),
      60_000,
    );

    expect(call.settled()).toBe(false);
    stop.abort();
    await call.pending;
  });

  it("lets the httpClientOptions atom disable the default", async ({
    expect,
  }) => {
    const { caller, past } = await start((alepha) =>
      alepha.store.mut(httpClientOptions, () => ({ timeout: false as const })),
    );
    const stop = new AbortController();

    const call = await past(
      () => caller.http.fetch(caller.url("/hang"), { signal: stop.signal }),
      60_000,
    );

    expect(call.settled()).toBe(false);
    stop.abort();
    await call.pending;
  });

  it("never applies the default to fetchAction, the app's own action", async ({
    expect,
  }) => {
    const { upstream, past } = await start();
    const stop = new AbortController();

    const call = await past(
      () => upstream.action.fetch({}, { request: { signal: stop.signal } }),
      60_000,
    );

    expect(call.settled()).toBe(false);
    stop.abort();
    await call.pending;
  });
});
