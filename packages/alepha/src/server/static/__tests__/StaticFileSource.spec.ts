import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { brotliCompressSync } from "node:zlib";

import { $hook, $inject, Alepha } from "alepha";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  AlephaServerStatic,
  type ServePrimitiveOptions,
  ServerStaticProvider,
  type StaticFileSource,
  type StaticFileStat,
} from "../index.ts";

/**
 * A source held in memory, so the handler can be driven without a disk and
 * without Bun. `gone` marks a file that was listed at boot but can no longer
 * be opened, the way a file deleted after boot behaves on disk.
 */
class MemoryStaticFileSource implements StaticFileSource {
  protected readonly files: Record<string, MemoryStaticFile>;

  constructor(files: Record<string, MemoryStaticFile>) {
    this.files = files;
  }

  public async list(): Promise<string[]> {
    return Object.keys(this.files);
  }

  public async stat(path: string): Promise<StaticFileStat> {
    const file = this.files[path];
    return {
      size: Buffer.byteLength(file.body),
      mtime: file.mtime ?? new Date(0),
    };
  }

  public async has(path: string): Promise<boolean> {
    return path in this.files;
  }

  public async open(path: string): Promise<Readable | undefined> {
    const file = this.files[path];
    if (!file || file.gone) {
      return undefined;
    }
    return Readable.from([Buffer.from(file.body)]);
  }
}

interface MemoryStaticFile {
  body: string | Buffer;
  mtime?: Date;
  gone?: boolean;
}

/**
 * A root that does not exist: given a source, the server must read only the
 * source, so any fallback to the disk fails the boot instead of passing.
 */
const missingRoot = join(tmpdir(), "alepha-static-source-no-such-root");

const setupServer = async (
  source: StaticFileSource,
  options: ServePrimitiveOptions = {},
) => {
  class TestApp {
    protected readonly staticProvider = $inject(ServerStaticProvider);

    protected readonly mount = $hook({
      on: "configure",
      handler: async () => {
        await this.staticProvider.createStaticServer(
          { root: missingRoot, ...options },
          source,
        );
      },
    });
  }

  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaServer)
    .with(AlephaServerStatic)
    .with(TestApp);

  await alepha.start();
  return alepha.inject(ServerProvider).hostname;
};

describe("ServerStaticProvider with a StaticFileSource", () => {
  it("serves the files the source lists, with their content type and bytes", async () => {
    const hostname = await setupServer(
      new MemoryStaticFileSource({
        "/app.css": { body: "body { color: red; }" },
        "/assets/nested.css": { body: "p { margin: 0; }" },
      }),
    );

    const top = await fetch(`${hostname}/app.css`);
    expect(top.status).toBe(200);
    expect(top.headers.get("content-type")).toBe("text/css");
    expect(await top.text()).toBe("body { color: red; }");

    const nested = await fetch(`${hostname}/assets/nested.css`);
    expect(nested.status).toBe(200);
    expect(await nested.text()).toBe("p { margin: 0; }");
  });

  it("answers 404 for a path the source does not list", async () => {
    const hostname = await setupServer(
      new MemoryStaticFileSource({ "/app.css": { body: "a" } }),
    );

    const response = await fetch(`${hostname}/missing.css`);
    expect(response.status).toBe(404);
  });

  it("serves the brotli sibling only to a client that accepts it", async () => {
    const css = "body { color: blue; }";
    const hostname = await setupServer(
      new MemoryStaticFileSource({
        "/app.css": { body: css },
        "/app.css.br": { body: brotliCompressSync(css) },
      }),
    );

    const brotli = await fetch(`${hostname}/app.css`, {
      headers: { "accept-encoding": "br" },
    });
    expect(brotli.headers.get("content-encoding")).toBe("br");
    expect(brotli.headers.get("vary")).toContain("accept-encoding");
    expect(await brotli.text()).toBe(css);

    const plain = await fetch(`${hostname}/app.css`, {
      headers: { "accept-encoding": "identity" },
    });
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(await plain.text()).toBe(css);
  });

  it("derives ETag and Last-Modified from the source's stat, and answers 304", async () => {
    // 11 bytes, modified 2026-01-02T03:04:05Z = 1767323045000 ms, a Friday.
    const hostname = await setupServer(
      new MemoryStaticFileSource({
        "/app.css": {
          body: "hello world",
          mtime: new Date("2026-01-02T03:04:05Z"),
        },
      }),
    );

    const first = await fetch(`${hostname}/app.css`);
    expect(first.headers.get("etag")).toBe('"11-1767323045000"');
    expect(first.headers.get("last-modified")).toBe(
      "Fri, 02 Jan 2026 03:04:05 GMT",
    );

    const byEtag = await fetch(`${hostname}/app.css`, {
      headers: { "if-none-match": '"11-1767323045000"' },
    });
    expect(byEtag.status).toBe(304);

    const byDate = await fetch(`${hostname}/app.css`, {
      headers: { "if-modified-since": "Fri, 02 Jan 2026 03:04:05 GMT" },
    });
    expect(byDate.status).toBe(304);
  });

  it("applies cache-control from the options", async () => {
    const hostname = await setupServer(
      new MemoryStaticFileSource({ "/app.css": { body: "a" } }),
      { cacheControl: { fileTypes: [".css"], maxAge: [1, "day"] } },
    );

    const response = await fetch(`${hostname}/app.css`);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=86400, immutable",
    );
  });

  it("answers 404 when a listed file can no longer be opened", async () => {
    const hostname = await setupServer(
      new MemoryStaticFileSource({ "/app.css": { body: "a", gone: true } }),
    );

    const response = await fetch(`${hostname}/app.css`);
    expect(response.status).toBe(404);
  });

  it("falls back to index.html through the source for history API routes", async () => {
    const hostname = await setupServer(
      new MemoryStaticFileSource({
        "/index.html": { body: "<h1>From the source</h1>" },
      }),
      { historyApiFallback: true },
    );

    const response = await fetch(`${hostname}/some/deep/route`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(await response.text()).toBe("<h1>From the source</h1>");
  });
});
