import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha } from "alepha";
import { ServerProvider } from "alepha/server";
import { afterAll, beforeAll, describe, it } from "vitest";

import { $serve } from "../index.ts";

/**
 * `$serve({ site: true })` (#Q3324): the rules Bay applies to a static site,
 * on the cases Bay's own tests cover (`bay/internal/proxy/static_test.go`).
 */
describe("$serve site rules", () => {
  let dir: string;
  let shellless: string;
  let bare: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "alepha-serve-site-"));
    await writeFile(join(dir, "index.html"), "home");
    await writeFile(join(dir, "about.html"), "about");
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(join(dir, "docs", "start.html"), "docs start");
    await writeFile(join(dir, "primitive-$sitemap.html"), "sitemap page");
    await mkdir(join(dir, "guide"), { recursive: true });
    await writeFile(join(dir, "guide", "index.html"), "guide index");
    await writeFile(join(dir, "200.html"), "spa shell");
    await writeFile(join(dir, "404.html"), "not found page");
    await writeFile(join(dir, "app.js"), "boot()");
    await writeFile(join(dir, "_headers"), "/*\n  X-Site: yes\n");

    shellless = await mkdtemp(join(tmpdir(), "alepha-serve-site-noshell-"));
    await writeFile(join(shellless, "index.html"), "home");
    await writeFile(join(shellless, "404.html"), "not found page");

    bare = await mkdtemp(join(tmpdir(), "alepha-serve-site-bare-"));
    await writeFile(join(bare, "index.html"), "home");
  });

  afterAll(async () => {
    for (const it of [dir, shellless, bare]) {
      await rm(it, { recursive: true, force: true });
    }
  });

  const start = async (root: string) => {
    class Site {
      files = $serve({ root, site: true, headersFile: true });
    }
    const alepha = Alepha.create().with(Site);
    await alepha.start();
    const base = alepha.inject(ServerProvider).hostname;
    return {
      get: async (path: string) => {
        const response = await fetch(`${base}${path}`);
        return {
          status: response.status,
          body: await response.text(),
          headers: response.headers,
        };
      },
      stop: () => alepha.stop(),
    };
  };

  it("serves the root index", async ({ expect }) => {
    const site = await start(dir);
    expect(await site.get("/")).toMatchObject({ status: 200, body: "home" });
    await site.stop();
  });

  it("resolves an extensionless path to its flat .html file, nested too", async ({
    expect,
  }) => {
    const site = await start(dir);
    expect(await site.get("/about")).toMatchObject({
      status: 200,
      body: "about",
    });
    expect(await site.get("/docs/start")).toMatchObject({
      status: 200,
      body: "docs start",
    });
    await site.stop();
  });

  it("resolves an encoded path to its decoded file", async ({ expect }) => {
    const site = await start(dir);
    expect(await site.get("/primitive-%24sitemap")).toMatchObject({
      status: 200,
      body: "sitemap page",
    });
    await site.stop();
  });

  it("resolves a directory index", async ({ expect }) => {
    const site = await start(dir);
    expect(await site.get("/guide")).toMatchObject({
      status: 200,
      body: "guide index",
    });
    await site.stop();
  });

  it("falls back to the SPA shell with 200 for an unknown route, and applies _headers to it", async ({
    expect,
  }) => {
    const site = await start(dir);
    const answer = await site.get("/some/client/route");
    expect(answer).toMatchObject({ status: 200, body: "spa shell" });
    expect(answer.headers.get("x-site")).toBe("yes");
    await site.stop();
  });

  it("never falls back to the shell for a missing asset: 404.html with 404", async ({
    expect,
  }) => {
    const site = await start(dir);
    expect(await site.get("/missing-chunk.js")).toMatchObject({
      status: 404,
      body: "not found page",
    });
    expect(await site.get("/_headers")).toMatchObject({
      status: 404,
      body: "not found page",
    });
    await site.stop();
  });

  it("serves the not-found page when there is no shell", async ({ expect }) => {
    const site = await start(shellless);
    expect(await site.get("/unknown")).toMatchObject({
      status: 404,
      body: "not found page",
    });
    await site.stop();
  });

  it("still 404s with no fallback files", async ({ expect }) => {
    const site = await start(bare);
    expect((await site.get("/unknown")).status).toBe(404);
    await site.stop();
  });
});
