import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha } from "alepha";
import { AlephaServer, ServerProvider } from "alepha/server";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  $serve,
  AlephaServerStatic,
  DiskStaticFileSource,
  type ServePrimitiveOptions,
  StaticSiteServer,
} from "../index.ts";

/**
 * Where a `$serve` mounts its files: the root however it is spelled, the
 * `index.html` alias, and `disabled`.
 */
describe("$serve mounting", () => {
  let dir: string;
  let dist: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "alepha-serve-mount-"));
    await writeFile(join(dir, "index.html"), "home");
    await writeFile(join(dir, "blogindex.html"), "blogindex");
    await mkdir(join(dir, "guide"), { recursive: true });
    await writeFile(join(dir, "guide", "index.html"), "guide index");
    await writeFile(join(dir, "app.js"), "boot()");
    await writeFile(join(dir, "200.html"), "shell");
    await writeFile(join(dir, "404.html"), "not found page");
    await writeFile(join(dir, "_headers"), "/*\n  X-Site: yes\n");
    await writeFile(join(dir, "_redirects"), "/old /new 301\n");

    dist = await mkdtemp(join(tmpdir(), "alepha-serve-mount-site-"));
    await mkdir(join(dist, "public"), { recursive: true });
    await writeFile(join(dist, "public", "index.html"), "home");
    await writeFile(join(dist, "public", "200.html"), "shell");
    await writeFile(join(dist, "public", "_headers"), "/*\n  X-Site: yes\n");
    await writeFile(join(dist, "manifest.json"), JSON.stringify({}));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(dist, { recursive: true, force: true });
  });

  const start = async (options: ServePrimitiveOptions) => {
    class App {
      files = $serve(options);
    }
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaServer)
      .with(AlephaServerStatic)
      .with(App);
    await alepha.start();
    return {
      base: alepha.inject(ServerProvider).hostname,
      stop: () => alepha.stop(),
    };
  };

  const get = async (url: string) => {
    const response = await fetch(url);
    return { status: response.status, body: await response.text() };
  };

  describe("a root spelled with a trailing slash", () => {
    for (const suffix of ["", "/", "//"]) {
      it(`lists the same URL paths with "${suffix}" appended`, async ({
        expect,
      }) => {
        const files = await new DiskStaticFileSource(`${dir}${suffix}`).list();

        expect(files.toSorted()).toEqual([
          "/200.html",
          "/404.html",
          "/_headers",
          "/_redirects",
          "/app.js",
          "/blogindex.html",
          "/guide/index.html",
          "/index.html",
        ]);
      });

      it(`serves under its prefix with "${suffix}" appended`, async ({
        expect,
      }) => {
        const { base, stop } = await start({
          root: `${dir}${suffix}`,
          path: "/static",
        });

        expect(await get(`${base}/static/app.js`)).toEqual({
          status: 200,
          body: "boot()",
        });
        expect((await get(`${base}/staticapp.js`)).status).toBe(404);

        await stop();
      });

      it(`hides the host's configuration files and answers the shell with "${suffix}" appended`, async ({
        expect,
      }) => {
        const { base, stop } = await start({
          root: `${dir}${suffix}`,
          headersFile: true,
          site: true,
        });

        expect((await get(`${base}/_headers`)).status).toBe(404);
        expect((await get(`${base}/_redirects`)).status).toBe(404);
        expect(await get(`${base}/some/route`)).toEqual({
          status: 200,
          body: "shell",
        });
        const file = await fetch(`${base}/app.js`);
        expect(file.headers.get("x-site")).toBe("yes");
        await file.text();

        await stop();
      });

      it(`serves a static site whose STATIC_ROOT has "${suffix}" appended`, async ({
        expect,
      }) => {
        const alepha = Alepha.create({
          env: {
            LOG_LEVEL: "error",
            SERVER_PORT: 0,
            STATIC_ROOT: `${join(dist, "public")}${suffix}`,
            STATIC_MANIFEST: join(dist, "manifest.json"),
          },
        }).with(StaticSiteServer);
        await alepha.start();
        const base = alepha.inject(ServerProvider).hostname;

        expect((await get(`${base}/_headers`)).status).toBe(404);
        expect(await get(`${base}/some/route`)).toEqual({
          status: 200,
          body: "shell",
        });
        expect(await get(`${base}/`)).toEqual({ status: 200, body: "home" });

        await alepha.stop();
      });
    }
  });

  describe("the index.html alias", () => {
    it("is given to a file named index.html, at the root and in a directory", async ({
      expect,
    }) => {
      const { base, stop } = await start({ root: dir });

      expect(await get(`${base}/`)).toEqual({ status: 200, body: "home" });
      expect(await get(`${base}/guide/`)).toEqual({
        status: 200,
        body: "guide index",
      });

      await stop();
    });

    it("is not given to a file whose name only ends with index.html", async ({
      expect,
    }) => {
      const { base, stop } = await start({ root: dir });

      expect((await get(`${base}/blog`)).status).toBe(404);
      expect(await get(`${base}/blogindex.html`)).toEqual({
        status: 200,
        body: "blogindex",
      });

      await stop();
    });

    it("is given under a prefix too", async ({ expect }) => {
      const { base, stop } = await start({ root: dir, path: "/static" });

      expect(await get(`${base}/static/`)).toEqual({
        status: 200,
        body: "home",
      });
      expect((await get(`${base}/static/blog`)).status).toBe(404);

      await stop();
    });
  });

  describe("disabled", () => {
    it("serves nothing", async ({ expect }) => {
      const { base, stop } = await start({ root: dir, disabled: true });

      expect((await get(`${base}/app.js`)).status).toBe(404);
      expect((await get(`${base}/`)).status).toBe(404);

      await stop();
    });

    it("serves when false", async ({ expect }) => {
      const { base, stop } = await start({ root: dir, disabled: false });

      expect((await get(`${base}/app.js`)).status).toBe(200);

      await stop();
    });
  });
});
