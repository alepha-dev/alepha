import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { Alepha } from "alepha/core";
import { AlephaServer, ServerProvider } from "alepha/server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  $serve,
  AlephaServerStatic,
  type ServeDescriptorOptions,
} from "../../src/server-static";

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
  const setupServer = async (serveOptions: ServeDescriptorOptions) => {
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
});
