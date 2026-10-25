import { extname } from "node:path";

import { describe, it } from "vitest";

import { CloudflareAssetManifest } from "../services/CloudflareAssetManifest.ts";

/**
 * Hash parity with wrangler, which is the one thing in the deploy path that
 * fails silently when it is wrong.
 *
 * ⚠️ **A wrong hash raises nothing.** Cloudflare simply never recognises a file
 * it already holds, so every deploy re-uploads every asset and a laptop deploy
 * and a Lore deploy never share one. The symptom is a bill and a latency, and
 * the cause is 32 characters that look plausible.
 *
 * The reference is wrangler's own `hashFile`, read out of
 * `wrangler@4.127.1/wrangler-dist/cli.js`:
 *
 * ```js
 * const base64Contents = contents.toString("base64");
 * const extension = path.extname(filepath).substring(1);
 * return blake3Wasm.hash(base64Contents + extension).toString("hex").slice(0, 32);
 * ```
 *
 * ⚠️ Checked against **`blake3-wasm`, the implementation wrangler actually
 * calls**, rather than against a `wrangler deploy --dry-run`. Stronger, and
 * the reason is not convenience: a dry run needs credentials and prints a plan,
 * while this compares digest to digest over real bytes. Both packages are
 * already in the tree as wrangler's own dependencies.
 */
describe("the Cloudflare asset manifest", () => {
  const manifest = new CloudflareAssetManifest();

  /**
   * wrangler's hash, computed with wrangler's own hasher.
   *
   * Loaded lazily and by name, because `blake3-wasm` is a transitive
   * dependency of wrangler rather than a declared one of this package: it is
   * a test oracle, and shipping it would put a wasm binary in a Worker bundle.
   */
  const wranglerHash = async (bytes: Buffer, path: string): Promise<string> => {
    const { hash } = (await import("blake3-wasm")) as unknown as {
      hash: (input: string) => { toString: (enc: string) => string };
    };
    const base64Contents = bytes.toString("base64");
    const extension = extname(path).substring(1);
    return hash(base64Contents + extension)
      .toString("hex")
      .slice(0, 32);
  };

  it("reproduces wrangler's hash byte for byte", async ({ expect }) => {
    const cases: Array<[string, Buffer]> = [
      ["index.html", Buffer.from("<!doctype html><title>x</title>")],
      ["assets/app.js", Buffer.from("export default 1;\n")],
      ["assets/app.css", Buffer.from("body{color:red}")],
      // No extension at all: wrangler appends nothing, and appending "" is
      // not the same as appending the file name.
      ["LICENSE", Buffer.from("MIT")],
      // A dotfile is a NAME, not an extension - `path.extname(".gitignore")`
      // is "".
      [".gitignore", Buffer.from("node_modules\n")],
      // A dot in a directory is not an extension of the file.
      ["dir.v2/README", Buffer.from("read me")],
      // Bytes that are not text, so the base64 step is doing real work.
      ["img/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe])],
      // Empty, which base64s to "" and still gets the extension appended.
      ["empty.txt", Buffer.alloc(0)],
    ];

    for (const [path, bytes] of cases) {
      expect(
        manifest.hash(new Uint8Array(bytes), path),
        `hash of ${path}`,
      ).toBe(await wranglerHash(bytes, path));
    }
  });

  it("keys an asset by its served path", ({ expect }) => {
    expect(manifest.key("index.html")).toBe("/index.html");
    expect(manifest.key("assets/app.js")).toBe("/assets/app.js");
    // Already absolute, and Windows separators, both normalised rather than
    // doubled - a `//index.html` key is a 404 nobody would look for here.
    expect(manifest.key("/index.html")).toBe("/index.html");
    expect(manifest.key("assets\\app.js")).toBe("/assets/app.js");
  });

  it("builds a manifest of hash and size", ({ expect }) => {
    const built = manifest.build([
      { path: "index.html", bytes: new Uint8Array(Buffer.from("hello")) },
    ]);

    expect(Object.keys(built)).toEqual(["/index.html"]);
    expect(built["/index.html"].size).toBe(5);
    expect(built["/index.html"].hash).toMatch(/^[0-9a-f]{32}$/);
  });

  /**
   * The parity check that matters, over files the size of a real build.
   *
   * The fixtures above are a few bytes each, so they never cross
   * `BASE64_CHUNK`: the one place a reproduction can be right on a small file
   * and wrong on a bundle. This ran over a built `apps/lore/dist/public` until
   * Lore left for github.com/alepha-dev/lore (#E72); deterministic bytes at
   * and around the chunk boundary prove the same thing without a build, so it
   * runs on every checkout instead of being skipped on a clean one.
   */
  it("agrees with wrangler on files past the base64 chunk size", async ({
    expect,
  }) => {
    // A fixed linear congruential sequence: bytes that look like a binary
    // asset, identical on every run.
    const bytesOf = (length: number, seed: number): Buffer => {
      const out = Buffer.alloc(length);
      let state = seed;
      for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        out[i] = state >>> 24;
      }
      return out;
    };

    const chunk = 0x8000;
    const cases: Array<[string, Buffer]> = [
      ["assets/below.js", bytesOf(chunk - 1, 1)],
      ["assets/exact.css", bytesOf(chunk, 2)],
      ["assets/above.js.map", bytesOf(chunk + 1, 3)],
      ["fonts/inter.woff2", bytesOf(chunk * 3 + 7, 4)],
      ["assets/vendor.js", bytesOf(250_000, 5)],
    ];

    for (const [path, bytes] of cases) {
      expect(manifest.hash(new Uint8Array(bytes), path), path).toBe(
        await wranglerHash(bytes, path),
      );
    }
  });
});
