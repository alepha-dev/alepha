import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";

import { Alepha } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { AlephaServer, ServerProvider } from "alepha/server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  $serve,
  AlephaServerStatic,
  type ServePrimitiveOptions,
} from "../index.ts";

// --- Test Setup: Create a temporary directory for static files ---

const tempTestDir = join(tmpdir(), `alepha-static-test-${Date.now()}`);
const tempWeirdFileName = "weird file 02020&&&&&éééé";

beforeAll(async () => {
  await mkdir(tempTestDir, { recursive: true });

  // Create some test files
  await writeFile(join(tempTestDir, "index.html"), "<h1>Hello World</h1>");
  await writeFile(join(tempTestDir, "style.css"), "body { color: red; }");
  await writeFile(join(tempTestDir, "script.js"), "console.log('test');");
  await writeFile(join(tempTestDir, ".secret"), "should-not-be-served");
  await writeFile(join(tempTestDir, tempWeirdFileName), "ok");

  // Create pre-compressed versions
  const cssContent = "body { color: blue; }";
  await writeFile(join(tempTestDir, "compressed.css"), cssContent);
  await writeFile(join(tempTestDir, "compressed.css.gz"), gzipSync(cssContent));
  await writeFile(
    join(tempTestDir, "compressed.css.br"),
    brotliCompressSync(cssContent),
  );
});

afterAll(async () => {
  // Clean up the temporary directory
  await rm(tempTestDir, { recursive: true, force: true });
});

// --- Test Suite ---

describe("alepha/server/static", () => {
  const setupServer = async (serveOptions: ServePrimitiveOptions) => {
    class TestApp {
      staticContent = $serve({ root: tempTestDir, ...serveOptions });
    }

    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with(AlephaServer)
      .with(AlephaServerStatic)
      .with(TestApp);

    await alepha.start();
    const server = alepha.inject(ServerProvider);

    return {
      hostname: server.hostname,
    };
  };

  test("should serve a basic static file with correct content-type", async () => {
    const { hostname } = await setupServer({});

    const response = await fetch(`${hostname}/style.css`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/css");
    expect(await response.text()).toBe("body { color: red; }");
  });

  test("should serve a file with invalid character", async () => {
    const { hostname } = await setupServer({});
    const r1 = await fetch(`${hostname}/${tempWeirdFileName}`);
    expect(r1.status).toBe(200);
    expect(await r1.text()).toBe("ok");

    const r2 = await fetch(`${hostname}/${encodeURI(tempWeirdFileName)}`);
    expect(r2.status).toBe(200);
    expect(await r2.text()).toBe("ok");
  });

  test("should serve index.html for root path", async () => {
    const { hostname } = await setupServer({});

    const response = await fetch(`${hostname}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(await response.text()).toBe("<h1>Hello World</h1>");
  });

  test("should handle ETag and Last-Modified headers for caching", async () => {
    const { hostname } = await setupServer({});

    const initialResponse = await fetch(`${hostname}/script.js`);
    const etag = initialResponse.headers.get("etag");
    const lastModified = initialResponse.headers.get("last-modified");

    expect(etag).toBeDefined();
    expect(lastModified).toBeDefined();

    // Second request with caching headers
    const cachedResponse = await fetch(`${hostname}/script.js`, {
      headers: {
        "if-none-match": etag!,
        "if-modified-since": lastModified!,
      },
    });

    expect(cachedResponse.status).toBe(304); // Not Modified
    expect(await cachedResponse.text()).toBe(""); // Body should be empty
  });

  test("should serve pre-compressed .gz file if accepted", async () => {
    const { hostname } = await setupServer({});

    const response = await fetch(`${hostname}/compressed.css`, {
      headers: { "Accept-Encoding": "gzip, deflate, br" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(response.headers.get("content-type")).toBe("text/css");
    // The fetched content will be automatically decompressed by fetch
    expect(await response.text()).toBe("body { color: blue; }");
  });

  test("should serve pre-compressed .br file if accepted and preferred", async () => {
    const { hostname } = await setupServer({});

    // Brotli is generally preferred by servers if available
    const response = await fetch(`${hostname}/compressed.css`, {
      headers: { "Accept-Encoding": "br, gzip" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(await response.text()).toBe("body { color: blue; }");
  });

  test("should not serve dotfiles by default", async () => {
    const { hostname } = await setupServer({});

    const response = await fetch(`${hostname}/.secret`);
    expect(response.status).toBe(404);
  });

  test("should serve dotfiles if ignoreDotEnvFiles is false", async () => {
    const { hostname } = await setupServer({ ignoreDotEnvFiles: false });

    const response = await fetch(`${hostname}/.secret`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("should-not-be-served");
  });

  test("should use historyApiFallback for SPA routing", async () => {
    const { hostname } = await setupServer({ historyApiFallback: true });

    // A path that doesn't correspond to a real file
    const response = await fetch(`${hostname}/some/deep/spa/route`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(await response.text()).toBe("<h1>Hello World</h1>");

    // Should still not fallback for paths that look like files
    const fileResponse = await fetch(`${hostname}/non-existent/style.css`);
    expect(fileResponse.status).toBe(404);
  });

  test("should apply Cache-Control headers for configured file types", async () => {
    const { hostname } = await setupServer({
      cacheControl: {
        fileTypes: [".css"],
        maxAge: [1, "day"],
        immutable: true,
      },
    });

    const cssResponse = await fetch(`${hostname}/style.css`);
    expect(cssResponse.headers.get("cache-control")).toBe(
      "public, max-age=86400, immutable",
    );

    // JS file should not have the header
    const jsResponse = await fetch(`${hostname}/script.js`);
    expect(jsResponse.headers.get("cache-control")).toBeNull();
  });

  test("should emit an hour as 3600, not 3.6", async () => {
    const { hostname } = await setupServer({
      cacheControl: { fileTypes: [".css"], maxAge: [1, "hour"] },
    });

    const response = await fetch(`${hostname}/style.css`);

    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=3600, immutable",
    );
  });

  /**
   * `maxAge` is a `DurationLike`, so a bare number is **milliseconds**. The SSR
   * static server passed `3600` meaning an hour and shipped `max-age=3.6` on
   * every asset of every Alepha app until someone read the header.
   *
   * The value is not second-guessed here - guessing the unit would hide the
   * mistake. What is guaranteed is that the header stays well-formed:
   * RFC 9111 defines `delta-seconds` as a non-negative integer, and a cache
   * meeting `max-age=3.6` may discard the directive, taking `immutable` with
   * it. So the number is rounded, and 3.6 seconds is loud enough to be noticed.
   */
  test("should always emit an integer delta-seconds", async () => {
    const { hostname } = await setupServer({
      cacheControl: { fileTypes: [".css"], maxAge: 3600 },
    });

    const response = await fetch(`${hostname}/style.css`);

    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=4, immutable",
    );
  });

  /**
   * The rounding above keeps the header legal; this is what makes the mistake
   * visible. No threshold on the resulting number would work - 3.6 seconds
   * looks like a duration someone could have chosen - so the warning keys on
   * the bare number instead, which in a `DurationLike` can only ever mean
   * milliseconds, and nobody caches in those.
   */
  test("should warn when maxAge is a bare number", async () => {
    class TestApp {
      staticContent = $serve({
        root: tempTestDir,
        cacheControl: { fileTypes: [".css"], maxAge: 3600 },
      });
    }

    const alepha = Alepha.create({ env: { LOG_LEVEL: "warn" } })
      .with({ provide: LogDestinationProvider, use: MemoryDestinationProvider })
      .with(AlephaServer)
      .with(AlephaServerStatic)
      .with(TestApp);

    await alepha.start();
    const logs = alepha.inject(MemoryDestinationProvider);
    const server = alepha.inject(ServerProvider);

    await fetch(`${server.hostname}/style.css`);

    expect(
      logs.logs.some(
        (log) =>
          log.level === "WARN" && log.message.includes("MILLISECONDS (3.6s)"),
      ),
    ).toBe(true);
  });
});
