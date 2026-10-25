import { $inject, Alepha, z } from "alepha";
import { describe, it } from "vitest";

import { $sse, AlephaServer, ServerProvider } from "../index.ts";

/**
 * A `$sse` handler's signal composes its stream's with the ambient one
 * (#E85), and the handler runs under it, so what it calls stops with it.
 */
describe("$sse signal", () => {
  it("aborts the handler's signal, which is the ambient one, when the client disconnects", async ({
    expect,
  }) => {
    let started!: () => void;
    const starting = new Promise<void>((r) => {
      started = r;
    });
    let aborted!: (reason: unknown) => void;
    const aborting = new Promise<unknown>((r) => {
      aborted = r;
    });
    let same = false;

    class App {
      alepha = $inject(Alepha);
      ticks = $sse({
        path: "/ticks",
        schema: { data: z.object({ n: z.integer() }) },
        handler: async ({ emit, signal }) => {
          same = signal === this.alepha.context.signal;
          emit({ n: 1 });
          started();
          await new Promise((resolve) => {
            signal.addEventListener("abort", resolve, { once: true });
          });
          aborted(signal.reason);
        },
      });
    }

    const alepha = Alepha.create().with(App).with(AlephaServer);
    const app = alepha.inject(App);
    await alepha.start();
    const hostname = alepha.inject(ServerProvider).hostname;

    const client = new AbortController();
    const res = await fetch(`${hostname}${app.ticks.prefix}${app.ticks.path}`, {
      method: "POST",
      headers: { accept: "text/event-stream" },
      signal: client.signal,
    });
    const reader = res.body!.getReader();
    await reader.read();
    await starting;
    client.abort();

    const reason = await aborting;
    expect(same).toBe(true);
    expect(alepha.context.isAbortError(reason)).toBe(true);
  });

  it("composes the caller's ambient signal for an in-process run()", async ({
    expect,
  }) => {
    let signal: AbortSignal | undefined;
    class App {
      alepha = $inject(Alepha);
      ticks = $sse({
        path: "/local",
        schema: { data: z.object({ n: z.integer() }) },
        handler: async (ctx) => {
          signal = ctx.signal;
          await new Promise((resolve) => {
            ctx.signal.addEventListener("abort", resolve, { once: true });
          });
        },
      });
    }

    const alepha = Alepha.create().with(App).with(AlephaServer);
    const app = alepha.inject(App);
    await alepha.start();

    const caller = new AbortController();
    alepha.context.run(() => app.ticks.run(), { signal: caller.signal });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(signal?.aborted).toBe(false);

    caller.abort();
    expect(signal?.aborted).toBe(true);
  });
});
