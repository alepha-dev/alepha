import { Alepha } from "alepha";
import { ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { ssrManifestAtom } from "../atoms/ssrManifestAtom.ts";
import { PAGE_PRELOAD_KEY } from "../constants/PAGE_PRELOAD_KEY.ts";
import { $page } from "../index.ts";

/**
 * Subresource Integrity on what a document has a tag for (#Q3319): the
 * entry script, the stylesheets, and every modulepreload.
 */
describe("Subresource Integrity in the document", () => {
  const sri = (name: string) => `sha384-${name}`;
  const manifest = {
    preload: {
      files: [
        "/entry.js",
        "/entry.css",
        "/chunk.entry-dep.js",
        "/chunk.home.js",
        "/home.css",
      ],
      integrity: [
        sri("entry"),
        sri("entrycss"),
        sri("dep"),
        sri("home"),
        sri("homecss"),
      ],
      keys: { home: [3, 4] },
      entry: { js: 0, css: [1], graph: [2] },
    },
  };

  const start = async () => {
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
    const html = await (
      await fetch(`${alepha.inject(ServerProvider).hostname}/`)
    ).text();
    return { alepha, html };
  };

  it("puts integrity on the entry script, the entry stylesheet and every modulepreload", async ({
    expect,
  }) => {
    const { alepha, html } = await start();
    try {
      expect(html).toContain(
        `<script type="module" crossorigin="" src="/entry.js" integrity="${sri("entry")}" async></script>`,
      );
      expect(html).toContain(
        `<link rel="stylesheet" href="/entry.css" integrity="${sri("entrycss")}" crossorigin="">`,
      );
      expect(html).toContain(
        `<link rel="modulepreload" href="/chunk.entry-dep.js" integrity="${sri("dep")}">`,
      );
      expect(html).toContain(
        `<link rel="modulepreload" href="/chunk.home.js" integrity="${sri("home")}">`,
      );
      // Vite inserts the page stylesheet itself, without integrity: a style
      // preload with one would be discarded and the file fetched twice.
      expect(html).toContain(
        '<link rel="preload" href="/home.css" as="style" crossorigin="">',
      );
    } finally {
      await alepha.stop();
    }
  });

  it("writes the entry's graph ahead of the entry script", async ({
    expect,
  }) => {
    const { alepha, html } = await start();
    try {
      expect(html.indexOf("/chunk.entry-dep.js")).toBeGreaterThan(-1);
      expect(html.indexOf("/chunk.entry-dep.js")).toBeLessThan(
        html.indexOf('src="/entry.js"'),
      );
    } finally {
      await alepha.stop();
    }
  });

  it("writes no integrity when the build recorded none", async ({ expect }) => {
    class App {
      home = $page({ path: "/", component: () => "body" });
    }
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    }).with(App);
    const { integrity: _, ...withoutIntegrity } = manifest.preload;
    alepha.store.set(ssrManifestAtom, { preload: withoutIntegrity });
    await alepha.start();
    try {
      const html = await (
        await fetch(`${alepha.inject(ServerProvider).hostname}/`)
      ).text();
      expect(html).toContain('src="/entry.js"');
      expect(html).not.toContain("integrity=");
    } finally {
      await alepha.stop();
    }
  });
});
