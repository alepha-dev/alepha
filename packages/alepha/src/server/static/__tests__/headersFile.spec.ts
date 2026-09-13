import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha } from "alepha";
import { AlephaServer, ServerProvider } from "alepha/server";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";

import {
  $serve,
  AlephaServerStatic,
  type ServePrimitiveOptions,
} from "../index.ts";

/**
 * The app's own static server applying `dist/public/_headers` (epic #E49),
 * through a real server and a real fetch, because the whole point is the
 * order it runs in against the other `server:onResponse` hooks.
 */
describe("$serve({ headersFile: true })", () => {
  let withHeaders = "";
  let withoutHeaders = "";
  let alepha: Alepha | undefined;

  beforeAll(async () => {
    withHeaders = await mkdtemp(join(tmpdir(), "alepha-headers-file-"));
    await writeFile(join(withHeaders, "index.html"), "<h1>home</h1>");
    await writeFile(join(withHeaders, "chunk.AbCd1234.js"), "export {};");
    await writeFile(join(withHeaders, "style.css"), "body{}");
    await writeFile(join(withHeaders, "logo.png"), "png");
    await writeFile(join(withHeaders, "café.txt"), "encoded");
    await writeFile(join(withHeaders, "_redirects"), "/old /new 301");
    await writeFile(join(withHeaders, ".assetsignore"), "*.map");
    await mkdir(join(withHeaders, "embed"));
    await writeFile(join(withHeaders, "embed", "widget.html"), "<p>w</p>");
    await writeFile(
      join(withHeaders, "_headers"),
      [
        "/",
        "  X-Root: yes",
        "/*.png",
        "  Cache-Control: public, max-age=86400",
        "/embed/*",
        "  ! X-Frame-Options",
        "/caf%C3%A9.txt",
        "  X-Encoded: yes",
        "/app/*",
        "  X-Route: app",
        "/chunk.*",
        "  ! Cache-Control",
        "  Cache-Control: public, max-age=31536000, immutable",
        "",
      ].join("\n"),
    );

    withoutHeaders = await mkdtemp(join(tmpdir(), "alepha-no-headers-file-"));
    await writeFile(join(withoutHeaders, "index.html"), "<h1>home</h1>");
    await writeFile(join(withoutHeaders, "style.css"), "body{}");
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  afterAll(async () => {
    await rm(withHeaders, { recursive: true, force: true });
    await rm(withoutHeaders, { recursive: true, force: true });
  });

  const serve = async (options: ServePrimitiveOptions) => {
    class TestApp {
      files = $serve(options);
    }
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaServer)
      .with(AlephaServerStatic)
      .with(TestApp);
    await alepha.start();
    return alepha.inject(ServerProvider).hostname;
  };

  /**
   * What `ReactServerProvider.configureStaticServer` passes, on an app
   * whose `_headers` is present.
   */
  const appServer = (extra: ServePrimitiveOptions = {}) =>
    serve({
      root: withHeaders,
      headersFile: true,
      cacheControl: { maxAge: [1, "hour"], immutable: true },
      ...extra,
    });

  it("caches a hashed chunk for a year, on top of helmet's headers", async ({
    expect,
  }) => {
    const host = await appServer();

    const response = await fetch(`${host}/chunk.AbCd1234.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("gives a file no rule caches Cloudflare's default, not the extension's hour", async ({
    expect,
  }) => {
    const host = await appServer();

    const response = await fetch(`${host}/style.css`);

    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });

  it("applies an author rule", async ({ expect }) => {
    const host = await appServer();

    const response = await fetch(`${host}/logo.png`);

    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  it("lets ! Name remove a header helmet added", async ({ expect }) => {
    // The trap this hook's priority exists for: removed inside the handler,
    // helmet's `server:onResponse` would have put it back.
    const host = await appServer();

    const embed = await fetch(`${host}/embed/widget.html`);
    const other = await fetch(`${host}/style.css`);

    expect(embed.headers.get("x-frame-options")).toBeNull();
    expect(other.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("applies the rules to a 304", async ({ expect }) => {
    const host = await appServer();
    const first = await fetch(`${host}/chunk.AbCd1234.js`);
    await first.arrayBuffer();

    const again = await fetch(`${host}/chunk.AbCd1234.js`, {
      headers: { "if-none-match": first.headers.get("etag") ?? "" },
    });

    expect(again.status).toBe(304);
    expect(again.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("matches the request path, not the file served: / is not /index.html", async ({
    expect,
  }) => {
    const host = await appServer();

    const root = await fetch(`${host}/`);
    const index = await fetch(`${host}/index.html`);

    expect(root.headers.get("x-root")).toBe("yes");
    expect(index.headers.get("x-root")).toBeNull();
  });

  it("applies the rules to the history fallback, by the path requested", async ({
    expect,
  }) => {
    const host = await appServer({ historyApiFallback: true });

    const response = await fetch(`${host}/app/settings`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<h1>home</h1>");
    expect(response.headers.get("x-route")).toBe("app");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });

  it("matches a percent-encoded path as the browser sends it", async ({
    expect,
  }) => {
    const host = await appServer();

    const response = await fetch(`${host}/caf%C3%A9.txt`);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-encoded")).toBe("yes");
  });

  it("matches under the path the server is mounted at", async ({ expect }) => {
    const host = await appServer({ path: "/static" });

    const response = await fetch(`${host}/static/logo.png`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  it("never serves _headers, _redirects or .assetsignore", async ({
    expect,
  }) => {
    const host = await appServer({ ignoreDotEnvFiles: false });

    for (const path of ["/_headers", "/_redirects", "/.assetsignore"]) {
      const response = await fetch(`${host}${path}`);
      expect(response.status, path).toBe(404);
    }
  });

  it("fails the boot on a _headers that does not parse, naming the line", async ({
    expect,
  }) => {
    const broken = await mkdtemp(join(tmpdir(), "alepha-broken-headers-"));
    await writeFile(join(broken, "index.html"), "<h1>home</h1>");
    await writeFile(join(broken, "_headers"), "/a\n  X-A: 1\n/movies/:id\n");

    try {
      await expect(serve({ root: broken, headersFile: true })).rejects.toThrow(
        /_headers:3: .*placeholder/,
      );
    } finally {
      await rm(broken, { recursive: true, force: true });
    }
  });

  it("changes nothing without a _headers", async ({ expect }) => {
    const host = await serve({
      root: withoutHeaders,
      headersFile: true,
      cacheControl: { maxAge: [1, "hour"], immutable: true },
    });

    const css = await fetch(`${host}/style.css`);
    const html = await fetch(`${host}/index.html`);

    expect(css.headers.get("cache-control")).toBe(
      "public, max-age=3600, immutable",
    );
    expect(html.headers.get("cache-control")).toBeNull();
    expect(css.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("leaves a $serve without headersFile alone, _headers served as a file", async ({
    expect,
  }) => {
    const host = await serve({ root: withHeaders });

    const file = await fetch(`${host}/_headers`);
    const chunk = await fetch(`${host}/chunk.AbCd1234.js`);

    expect(file.status).toBe(200);
    expect(chunk.headers.get("cache-control")).toBeNull();
  });
});
