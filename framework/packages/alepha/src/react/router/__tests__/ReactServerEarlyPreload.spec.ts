import { Alepha } from "alepha";
import { ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { ssrManifestAtom } from "../atoms/ssrManifestAtom.ts";
import { PAGE_PRELOAD_KEY } from "../constants/PAGE_PRELOAD_KEY.ts";
import { $page } from "../index.ts";
import { ReactServerProvider } from "../providers/ReactServerProvider.ts";

/**
 * A build whose entry pulls one chunk of its own, and whose only page pulls
 * another.
 */
const manifest = {
  preload: {
    files: ["/entry.js", "/chunk.entry-dep.js", "/chunk.home.js"],
    keys: { home: [2] },
    entry: { js: 0, css: [], graph: [1] },
  },
};

/**
 * Read from a stream until it says what we are waiting for, or give up.
 *
 * Giving up is the point: if the links are emitted behind the loader, nothing
 * arrives at all while the loader is held, and this fails in seconds instead
 * of hanging until the suite's own timeout.
 */
const readUntil = async (
  stream: ReadableStream<Uint8Array>,
  needle: string,
  timeoutMs = 5_000,
): Promise<string> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let seen = "";

  const deadline = new Promise<never>((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`never saw "${needle}", read: ${seen}`)),
      timeoutMs,
    );
    timer.unref?.();
  });

  try {
    while (!seen.includes(needle)) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      seen += decoder.decode(value, { stream: true });
    }
    return seen;
  } finally {
    await reader.cancel().catch(() => {});
  }
};

describe("ReactServerProvider early preload", () => {
  it("should stream the page's preload links before its loader resolves", async ({
    expect,
  }) => {
    const gate = Promise.withResolvers<void>();

    class App {
      home = $page({
        path: "/",
        [PAGE_PRELOAD_KEY]: "home",
        loader: async () => {
          await gate.promise;
          return {};
        },
        component: () => "the page body",
      });
    }

    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    }).with(App);
    alepha.store.set(ssrManifestAtom, manifest);

    await alepha.start();
    const server = alepha.inject(ServerProvider);

    const response = await fetch(`${server.hostname}/`);
    const early = await readUntil(response.body!, "/chunk.home.js");

    expect(early).toContain('<link rel="modulepreload" href="/chunk.home.js">');
    // The loader is still held, so nothing of the page itself can be here yet.
    expect(early).not.toContain("the page body");

    gate.resolve();
    await alepha.stop();
  });

  it("should stream the entry's own graph before the loader too", async ({
    expect,
  }) => {
    const gate = Promise.withResolvers<void>();

    class App {
      home = $page({
        path: "/",
        loader: async () => {
          await gate.promise;
          return {};
        },
        component: () => "the page body",
      });
    }

    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    }).with(App);
    alepha.store.set(ssrManifestAtom, manifest);

    await alepha.start();
    const server = alepha.inject(ServerProvider);

    const response = await fetch(`${server.hostname}/`);
    const early = await readUntil(response.body!, "/chunk.entry-dep.js");

    expect(early).toContain(
      '<link rel="modulepreload" href="/chunk.entry-dep.js">',
    );
    expect(early).not.toContain("the page body");

    gate.resolve();
    await alepha.stop();
  });

  it("should carry the same links on a prerendered document", async ({
    expect,
  }) => {
    class App {
      home = $page({
        path: "/",
        [PAGE_PRELOAD_KEY]: "home",
        component: () => "the page body",
      });
    }

    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    }).with(App);
    alepha.store.set(ssrManifestAtom, manifest);

    await alepha.start();

    const react = alepha.inject(ReactServerProvider);
    const { html } = await react.render("home", { html: true });

    expect(html).toContain('<link rel="modulepreload" href="/chunk.home.js">');
    expect(html).toContain(
      '<link rel="modulepreload" href="/chunk.entry-dep.js">',
    );
    expect(html).toContain("the page body");

    await alepha.stop();
  });

  it("should not emit a page's links twice on the streamed document", async ({
    expect,
  }) => {
    class App {
      home = $page({
        path: "/",
        [PAGE_PRELOAD_KEY]: "home",
        component: () => "the page body",
      });
    }

    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    }).with(App);
    alepha.store.set(ssrManifestAtom, manifest);

    await alepha.start();
    const server = alepha.inject(ServerProvider);

    const response = await fetch(`${server.hostname}/`);
    const html = await response.text();

    expect(html.split('href="/chunk.home.js"').length - 1).toBe(1);
    expect(html.split('href="/chunk.entry-dep.js"').length - 1).toBe(1);

    await alepha.stop();
  });
});
