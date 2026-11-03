import { Alepha } from "alepha";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { $manifest, $robots, $sitemap, AlephaReactSitemap } from "../index.ts";

describe("$robots", () => {
  const start = async (
    App: new () => object,
    env: Record<string, string> = {},
  ) => {
    const alepha = Alepha.create({ env: { SERVER_PORT: 0, ...env } })
      .with(AlephaServer)
      .with(AlephaReactSitemap)
      .with(App);
    await alepha.start();
    const base = alepha.inject(ServerProvider).hostname;
    return {
      alepha,
      get: (path: string, headers: Record<string, string> = {}) =>
        fetch(`${base}${path}`, { headers }),
    };
  };

  class App {
    robots = $robots({
      host: "https://example.com",
      disallow: ["/admin", "/account"],
    });
  }

  it("answers its rules on the canonical host", async ({ expect }) => {
    const { get } = await start(App);

    const res = await get("/robots.txt", {
      "x-forwarded-host": "example.com",
    });

    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe(
      "User-agent: *\nDisallow: /admin\nDisallow: /account\n",
    );
  });

  it("answers Disallow: / on any other host", async ({ expect }) => {
    const { get } = await start(App);

    const res = await get("/robots.txt", {
      "x-forwarded-host": "staging.example.com",
    });

    expect(await res.text()).toBe("User-agent: *\nDisallow: /\n");
  });

  it("takes the canonical host from PUBLIC_URL", async ({ expect }) => {
    class PublicUrl {
      robots = $robots();
    }

    const { get } = await start(PublicUrl, {
      PUBLIC_URL: "https://public.example.com",
    });

    const canonical = await get("/robots.txt", {
      "x-forwarded-host": "public.example.com",
    });
    const preview = await get("/robots.txt", {
      "x-forwarded-host": "app.workers.dev",
    });

    expect(await canonical.text()).toBe("User-agent: *\nAllow: /\n");
    expect(await preview.text()).toBe("User-agent: *\nDisallow: /\n");
  });

  it("lets production decide when no host is known", async ({ expect }) => {
    class NoHost {
      robots = $robots();
    }

    const { get } = await start(NoHost, { NODE_ENV: "production" });
    expect(await (await get("/robots.txt")).text()).toBe(
      "User-agent: *\nAllow: /\n",
    );
  });

  it("refuses crawlers outside production when no host is known", async ({
    expect,
  }) => {
    class NoHost {
      robots = $robots();
    }

    const { get } = await start(NoHost);
    expect(await (await get("/robots.txt")).text()).toBe(
      "User-agent: *\nDisallow: /\n",
    );
  });

  it("adds an absolute sitemap, and leaves a relative one out", async ({
    expect,
  }) => {
    class WithSitemap {
      robots = $robots({ host: "example.com" });
      sitemap = $sitemap({ hostname: "https://example.com" });
    }

    class RelativeSitemap {
      robots = $robots({ host: "example.com" });
      sitemap = $sitemap();
    }

    const absolute = await start(WithSitemap);
    const relative = await start(RelativeSitemap);
    const headers = { "x-forwarded-host": "example.com" };

    expect(await (await absolute.get("/robots.txt", headers)).text()).toContain(
      "Sitemap: https://example.com/sitemap.xml\n",
    );
    expect(
      await (await relative.get("/robots.txt", headers)).text(),
    ).not.toContain("Sitemap:");
  });

  it("does not prerender unless asked", ({ expect }) => {
    class Prerendered {
      robots = $robots({ static: true });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaReactSitemap)
      .with(Prerendered);
    const primitive = alepha.inject(Prerendered).robots;

    expect(primitive.prerender()).toEqual({
      path: "/robots.txt",
      body: "User-agent: *\nAllow: /\n",
    });
  });
});

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
});
