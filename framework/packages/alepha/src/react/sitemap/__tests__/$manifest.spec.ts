import { Alepha } from "alepha";
import { HeadProvider } from "alepha/react/head";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { $manifest, AlephaReactSitemap } from "../index.ts";

describe("$manifest", () => {
  class App {
    manifest = $manifest({
      name: "My App",
      shortName: "App",
      themeColor: "#010409",
      icons: [{ src: "/logo.png", sizes: "512x512", type: "image/png" }],
      screenshots: [{ src: "/shot.png", formFactor: "wide" }],
    });
  }

  it("answers application/manifest+json in the manifest's spelling", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { SERVER_PORT: 0 } })
      .with(AlephaServer)
      .with(AlephaReactSitemap)
      .with(App);
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/manifest.webmanifest`,
    );

    expect(res.headers.get("content-type")).toContain(
      "application/manifest+json",
    );
    expect(await res.json()).toEqual({
      name: "My App",
      short_name: "App",
      display: "standalone",
      start_url: "/",
      theme_color: "#010409",
      icons: [{ src: "/logo.png", sizes: "512x512", type: "image/png" }],
      screenshots: [{ src: "/shot.png", form_factor: "wide" }],
    });
  });

  it("is what the build snapshots", ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaReactSitemap)
      .with(App);

    expect(alepha.inject(App).manifest.prerender().path).toBe(
      "/manifest.webmanifest",
    );
  });

  it("links the manifest from every page's head", ({ expect }) => {
    class Custom {
      manifest = $manifest({ name: "My App", path: "/app.webmanifest" });
    }
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaReactSitemap)
      .with(Custom);
    alepha.inject(Custom);

    expect(alepha.inject(HeadProvider).resolveGlobal().link).toEqual([
      { rel: "manifest", href: "/app.webmanifest" },
    ]);
  });
});
