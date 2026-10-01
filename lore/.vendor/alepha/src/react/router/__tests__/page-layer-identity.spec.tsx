import { Alepha, z } from "alepha";
import { describe, it } from "vitest";

import { $page } from "../index.ts";
import { ReactPageProvider } from "../providers/ReactPageProvider.ts";
import { ReactServerTemplateProvider } from "../providers/ReactServerTemplateProvider.ts";

/**
 * A layer's identity, on the server side of the round trip (#Q2349).
 *
 * Each layer is keyed by its path compiled from the raw matched params. The
 * SSR payload carries that key, because the browser's first render compares
 * it against its own to decide whether to reuse the server's layers: without
 * it, hydration would re-run every loader.
 */
describe("page layer identity", () => {
  const setup = async () => {
    const loads = { project: 0, folio: 0 };

    class App {
      root = $page({ path: "/", component: () => "root" });
      project = $page({
        path: "/:slug",
        parent: this.root,
        schema: { params: z.object({ slug: z.string() }) },
        loader: async () => {
          loads.project++;
          return {};
        },
        component: () => "project",
      });
      folio = $page({
        path: "/folios/:id",
        parent: this.project,
        loader: async () => {
          loads.folio++;
          return {};
        },
        component: () => "folio",
      });
      docs = $page({
        path: "/docs/*",
        parent: this.root,
        component: () => "docs",
      });
    }

    const alepha = Alepha.create({
      env: { PUBLIC_URL: "https://example.com" },
    });
    const app = alepha.inject(App);
    await alepha.start();
    return {
      app,
      loads,
      pages: alepha.inject(ReactPageProvider),
      template: alepha.inject(ReactServerTemplateProvider),
    };
  };

  it("keys each layer by its path compiled from the raw params, a schema-less one included", async ({
    expect,
  }) => {
    const { app } = await setup();

    const rendered = await app.folio.render({
      params: { slug: "alepha", id: "1012" },
    });

    expect(rendered.state.layers.map((layer) => layer.key)).toEqual([
      "/",
      "/alepha",
      "/alepha/folios/1012",
    ]);
  });

  it("carries the keys in the SSR payload, so hydration reuses every layer", async ({
    expect,
  }) => {
    const { app, loads, pages, template } = await setup();

    const rendered = await app.folio.render({
      params: { slug: "alepha", id: "1012" },
    });
    expect(loads).toEqual({ project: 1, folio: 1 });

    // What the browser reads back out of `#__ssr`.
    const payload = JSON.parse(
      JSON.stringify(template.buildHydrationData(rendered.state)),
    );
    const previous = payload["alepha.react.router.layers"];
    expect(previous.map((layer: { key?: string }) => layer.key)).toEqual([
      "/",
      "/alepha",
      "/alepha/folios/1012",
    ]);

    const hydrated = await pages.createLayers(
      pages.page("folio"),
      {
        url: new URL("https://example.com/alepha/folios/1012"),
        params: { slug: "alepha", id: "1012" },
        query: {},
        layers: [],
        onError: () => null,
        meta: {},
      } as any,
      previous,
    );

    expect(hydrated.state?.layers.map((layer) => layer.cache)).toEqual([
      true,
      true,
      true,
    ]);
    expect(loads).toEqual({ project: 1, folio: 1 });
  });

  it("includes a wildcard's capture", async ({ expect }) => {
    const { app } = await setup();

    const rendered = await app.docs.render({
      params: { "*": "guides/routing" },
    });

    expect(rendered.state.layers.at(-1)?.key).toBe("/docs/guides/routing");
  });
});
