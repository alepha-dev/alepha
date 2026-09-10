import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";

import { $hook, $inject, Alepha } from "alepha";
import { AlephaServer, ServerProvider } from "alepha/server";

import {
  AlephaServerStatic,
  EmbeddedStaticFileSource,
  ServerStaticProvider,
} from "../index.ts";

// -------------------------------------------------------------------------------------------------------------------

/**
 * 21 bytes. In a compiled binary the map points into `/$bunfs/root/`; here it
 * points at real temp files, which `Bun.file()` reads the same way.
 */
const css = "body { color: teal; }";
const brotli = brotliCompressSync(css);

/**
 * 2026-01-02T03:04:05Z, the build time a compiled binary would carry.
 */
const builtAt = 1767323045000;

let dir = "";
let files: Record<string, string> = {};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "alepha-embedded-source-"));
  await writeFile(join(dir, "app.css"), css);
  await writeFile(join(dir, "app.css.br"), brotli);
  files = {
    "/app.css": join(dir, "app.css"),
    "/app.css.br": join(dir, "app.css.br"),
  };
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("EmbeddedStaticFileSource", () => {
  it("lists the URL paths of its map", async () => {
    const source = new EmbeddedStaticFileSource(files, builtAt);
    expect(await source.list()).toEqual(["/app.css", "/app.css.br"]);
  });

  it("stats a file by its real size and the build time", async () => {
    const source = new EmbeddedStaticFileSource(files, builtAt);
    expect(await source.stat("/app.css")).toEqual({
      size: 21,
      mtime: new Date(1767323045000),
    });
  });

  it("knows which files it holds", async () => {
    const source = new EmbeddedStaticFileSource(files, builtAt);
    expect(await source.has("/app.css.br")).toBe(true);
    expect(await source.has("/missing.css")).toBe(false);
  });

  it("streams a file's bytes, and nothing for a path it does not hold", async () => {
    const source = new EmbeddedStaticFileSource(files, builtAt);

    const stream = await source.open("/app.css");
    expect(await new Response(stream as unknown as ReadableStream).text()).toBe(
      css,
    );
    expect(await source.open("/missing.css")).toBeUndefined();
  });
});

describe("EmbeddedStaticFileSource behind the static server", () => {
  let alepha: Alepha | undefined;

  afterAll(async () => {
    await alepha?.stop().catch(() => {});
  });

  it("serves an embedded file, and its brotli sibling to a client that accepts it", async () => {
    class TestApp {
      protected readonly staticProvider = $inject(ServerStaticProvider);

      protected readonly mount = $hook({
        on: "configure",
        handler: async () => {
          await this.staticProvider.createStaticServer(
            {},
            new EmbeddedStaticFileSource(files, builtAt),
          );
        },
      });
    }

    alepha = Alepha.create({ env: { NODE_ENV: "test", LOG_LEVEL: "error" } })
      .with(AlephaServer)
      .with(AlephaServerStatic)
      .with(TestApp);
    await alepha.start();
    const hostname = alepha.inject(ServerProvider).hostname;

    const plain = await fetch(`${hostname}/app.css`, {
      headers: { "accept-encoding": "identity" },
    });
    expect(plain.status).toBe(200);
    expect(plain.headers.get("content-type")).toBe("text/css");
    expect(plain.headers.get("etag")).toBe('"21-1767323045000"');
    expect(await plain.text()).toBe(css);

    const compressed = await fetch(`${hostname}/app.css`, {
      headers: { "accept-encoding": "br" },
      decompress: false,
    });
    expect(compressed.headers.get("content-encoding")).toBe("br");
    expect(Buffer.from(await compressed.arrayBuffer())).toEqual(
      Buffer.from(brotli),
    );
  });
});
