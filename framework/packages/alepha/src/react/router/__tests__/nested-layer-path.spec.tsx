import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $page } from "../index.ts";

describe("nested layer paths", () => {
  it("collapses every doubled slash, not only the first run", async () => {
    // Three levels deep with leading-slash paths, the documented style: the
    // server-side layer accumulator used to come out as `/alepha//folios//1012`,
    // which is what the canonical URL and the exit-animation match were built
    // from.
    class App {
      root = $page({ path: "/", component: () => "root" });
      project = $page({
        path: "/:slug",
        parent: this.root,
        schema: { params: z.object({ slug: z.string() }) },
        component: () => "project",
      });
      folios = $page({
        path: "/folios",
        parent: this.project,
        component: () => "folios",
      });
      folio = $page({
        path: "/:id",
        parent: this.folios,
        schema: { params: z.object({ id: z.string() }) },
        component: () => "folio",
      });
    }

    const alepha = Alepha.create({
      env: { PUBLIC_URL: "https://example.com" },
    });
    const app = alepha.inject(App);
    await alepha.start();

    const rendered = await app.folio.render({
      params: { slug: "alepha", id: "1012" },
    });

    expect(rendered.state.layers.map((layer) => layer.path)).toEqual([
      "/",
      "/alepha",
      "/alepha/folios",
      "/alepha/folios/1012",
    ]);
    expect(rendered.state.head?.url).toBe(
      "https://example.com/alepha/folios/1012",
    );
  });
});
