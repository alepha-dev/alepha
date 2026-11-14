import { Alepha } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { describe, it } from "vitest";

import { AlephaReactRouter } from "../index.ts";
import { PageCacheSink } from "../providers/ReactPageCacheProvider.ts";
import type { ReactRouterState } from "../providers/ReactPageProvider.ts";
import { ReactServerTemplateProvider } from "../providers/ReactServerTemplateProvider.ts";

const encoder = new TextEncoder();

const stateFor = (path: string): ReactRouterState =>
  ({
    layers: [],
    url: new URL(`http://localhost${path}`),
    onError: () => null,
  }) as unknown as ReactRouterState;

/**
 * A React stream that writes its shell and then keeps streaming, one
 * Suspense boundary every few milliseconds, as a page does while its deferred
 * values resolve. Records whether it was cancelled, and how far it got.
 */
const pendingReactStream = () => {
  const seen: { cancelled?: unknown; chunks: number } = { chunks: 0 };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("<p>shell</p>"));
    },
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      seen.chunks += 1;
      if (seen.chunks > 20) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`<p>boundary ${seen.chunks}</p>`));
    },
    cancel(reason) {
      seen.cancelled = reason;
    },
  });
  return { stream, seen };
};

/**
 * A visitor who closes the tab or navigates away mid-render cancels the HTML
 * stream. That is not an error: nothing above debug, no throw, no error page
 * written into a stream nobody reads, React stopped, and no half page cached.
 */
describe("SSR stream cancelled by the client", () => {
  const boot = async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "debug" } })
      .with({ provide: LogDestinationProvider, use: MemoryDestinationProvider })
      .with(AlephaReactRouter);
    const destination = alepha.inject(MemoryDestinationProvider);
    await alepha.start();
    const template = alepha.inject(ReactServerTemplateProvider);
    const levels = (level: "ERROR" | "DEBUG") =>
      destination.logs
        .filter((entry) => entry.level === level)
        .map((entry) => entry.message);
    return { template, levels };
  };

  /** Reads until the React shell went out, then leaves. */
  const leaveAfterShell = async (html: ReadableStream<Uint8Array>) => {
    const reader = html.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("<p>shell</p>")) {
      const { done, value } = await reader.read();
      if (done) {
        throw new Error("the document ended before the shell");
      }
      text += decoder.decode(value, { stream: true });
    }
    await reader.cancel("client left");
    // Let the stream's start() run to its end.
    await new Promise((resolve) => setTimeout(resolve, 80));
  };

  it("createHtmlStream: cancel mid-body stops React and logs no error", async ({
    expect,
  }) => {
    const { template, levels } = await boot();
    const react = pendingReactStream();
    const sink = new PageCacheSink();
    const onError = (error: unknown) => {
      throw new Error(`onError called: ${String(error)}`);
    };

    await leaveAfterShell(
      template.createHtmlStream(react.stream, stateFor("/"), { sink, onError }),
    );

    expect(levels("ERROR")).toEqual([]);
    expect(levels("DEBUG")).toContain(
      "Client left mid-render, HTML stream cancelled",
    );
    expect(react.seen.cancelled).toBe("client left");
    expect(await sink.finished).toBe(false);
  });

  it("createEarlyHtmlStream: cancel mid-body stops React and logs no error", async ({
    expect,
  }) => {
    const { template, levels } = await boot();
    const react = pendingReactStream();
    const sink = new PageCacheSink();
    const state = stateFor("/");
    const onError = (error: unknown) => {
      throw new Error(`onError called: ${String(error)}`);
    };

    await leaveAfterShell(
      template.createEarlyHtmlStream(
        {},
        async () => ({ state, reactStream: react.stream }),
        { state, sink, onError },
      ),
    );

    expect(levels("ERROR")).toEqual([]);
    expect(react.seen.cancelled).toBe("client left");
    expect(await sink.finished).toBe(false);
  });

  it("createEarlyHtmlStream: cancel while the loaders run never reads React", async ({
    expect,
  }) => {
    const { template, levels } = await boot();
    const react = pendingReactStream();
    const sink = new PageCacheSink();
    const state = stateFor("/");
    let finishLoaders!: () => void;
    const loaders = new Promise<void>((resolve) => {
      finishLoaders = resolve;
    });

    const html = template.createEarlyHtmlStream(
      {},
      async () => {
        await loaders;
        return { state, reactStream: react.stream };
      },
      { state, sink },
    );
    const reader = html.getReader();
    await reader.read();
    await reader.cancel("client left");
    expect(await sink.finished).toBe(false);

    finishLoaders();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(levels("ERROR")).toEqual([]);
    expect(react.seen.cancelled).toBe("client left");
    expect(react.stream.locked).toBe(false);
  });
});
