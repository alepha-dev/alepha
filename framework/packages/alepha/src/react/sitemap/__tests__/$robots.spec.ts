import { Alepha } from "alepha";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { $robots, $sitemap, AlephaReactSitemap } from "../index.ts";
import type { RobotsPrimitive } from "../primitives/$robots.ts";

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

  it("is prerendered by the build only when asked", ({ expect }) => {
    class Live {
      robots = $robots();
    }
    class Prerendered {
      robots = $robots({ static: true });
    }
    const robotsOf = (App: new () => { robots: RobotsPrimitive }) =>
      Alepha.create()
        .with(AlephaServer)
        .with(AlephaReactSitemap)
        .with(App)
        .inject(App).robots;

    // The build prerenders the `robots` primitives whose `static` option is
    // set (`BuildPrerenderTask`); the file is the canonical host's rules.
    expect(robotsOf(Live).options.static).toBeUndefined();
    expect(robotsOf(Prerendered).options.static).toBe(true);
    expect(robotsOf(Prerendered).prerender()).toEqual({
      path: "/robots.txt",
      body: "User-agent: *\nAllow: /\n",
    });
  });

  it("reads the host of a schemeless canonical with a trailing slash", async ({
    expect,
  }) => {
    class PublicUrl {
      robots = $robots();
    }

    const { get } = await start(PublicUrl, { PUBLIC_URL: "example.com/" });

    const res = await get("/robots.txt", { "x-forwarded-host": "example.com" });

    expect(await res.text()).toBe("User-agent: *\nAllow: /\n");
  });
});
