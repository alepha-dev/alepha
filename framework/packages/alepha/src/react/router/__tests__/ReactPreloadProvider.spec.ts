import { Alepha } from "alepha";
import { HttpClient, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { ssrManifestAtom } from "../atoms/ssrManifestAtom.ts";
import { $page } from "../index.ts";

describe("ReactPreloadProvider", () => {
  class App {
    home = $page({
      path: "/",
      component: () => "Hello World",
    });
  }

  it("should add Link header with entry assets to HTML responses", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    }).with(App);

    // Set up mock SSR manifest with entry assets
    alepha.store.set(ssrManifestAtom, {
      preload: {
        files: ["/assets/entry.abc123.js", "/assets/style.def456.css"],
        keys: {},
        entry: { js: 0, css: [1], graph: [] },
      },
    });

    await alepha.start();

    const server = alepha.inject(ServerProvider);
    const http = alepha.inject(HttpClient);

    const response = await http.fetch(`${server.hostname}/`);

    // Check that the Link header is present
    const linkHeader = response.headers.get("link");
    expect(linkHeader).toBeTruthy();
    expect(linkHeader).toContain(
      "</assets/style.def456.css>; rel=preload; as=style",
    );
    expect(linkHeader).toContain(
      "</assets/entry.abc123.js>; rel=modulepreload",
    );

    await alepha.stop();
  });

  it("should not add Link header when no SSR manifest is available", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    }).with(App);

    // No SSR manifest set

    await alepha.start();

    const server = alepha.inject(ServerProvider);
    const http = alepha.inject(HttpClient);

    const response = await http.fetch(`${server.hostname}/`);

    // Link header should not be present (or empty)
    const linkHeader = response.headers.get("link");
    expect(linkHeader).toBeNull();

    await alepha.stop();
  });

  it("should carry the asset base the build baked into the hrefs", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    }).with(App);

    // Set up mock SSR manifest whose hrefs already carry the asset base: the
    // build applies it once rather than the runtime applying it per request.
    alepha.store.set(ssrManifestAtom, {
      preload: {
        files: ["/app/assets/entry.abc123.js", "/app/assets/style.def456.css"],
        keys: {},
        entry: { js: 0, css: [1], graph: [] },
      },
    });

    await alepha.start();

    const server = alepha.inject(ServerProvider);
    const http = alepha.inject(HttpClient);

    const response = await http.fetch(`${server.hostname}/`);

    // Check that the Link header includes base path
    const linkHeader = response.headers.get("link");
    expect(linkHeader).toBeTruthy();
    expect(linkHeader).toContain(
      "</app/assets/style.def456.css>; rel=preload; as=style",
    );
    expect(linkHeader).toContain(
      "</app/assets/entry.abc123.js>; rel=modulepreload",
    );

    await alepha.stop();
  });

  it("should handle entry with only JS (no CSS)", async ({ expect }) => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    }).with(App);

    // Set up mock SSR manifest with only JS entry
    alepha.store.set(ssrManifestAtom, {
      preload: {
        files: ["/assets/entry.abc123.js"],
        keys: {},
        entry: { js: 0, css: [], graph: [] },
      },
    });

    await alepha.start();

    const server = alepha.inject(ServerProvider);
    const http = alepha.inject(HttpClient);

    const response = await http.fetch(`${server.hostname}/`);

    // Check that the Link header contains only JS modulepreload
    const linkHeader = response.headers.get("link");
    expect(linkHeader).toBeTruthy();
    expect(linkHeader).toBe("</assets/entry.abc123.js>; rel=modulepreload");

    await alepha.stop();
  });
});
