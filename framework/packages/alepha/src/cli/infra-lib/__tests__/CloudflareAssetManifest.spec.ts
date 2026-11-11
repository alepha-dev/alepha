import { createHash } from "node:crypto";

import { describe, it } from "vitest";

import { CloudflareAssetManifest } from "../services/CloudflareAssetManifest.ts";

/**
 * The asset digest and the Cloudflare key it derives (#Q3377).
 *
 * ⚠️ **A wrong key raises nothing.** Cloudflare simply never recognises a file
 * it already holds, so every deploy re-uploads every asset, and a laptop deploy
 * and a Lore deploy that disagree never share one. The symptom is a bill and a
 * latency, which is why the scheme is pinned here digest for digest.
 *
 * The oracle is OpenSSL's SHA-256 through `node:crypto`, over the published
 * test vectors and over bytes computed independently of the class.
 */
describe("the Cloudflare asset manifest", () => {
  const manifest = new CloudflareAssetManifest();
  const bytes = (text: string) => new TextEncoder().encode(text);

  /**
   * The scheme, written out once outside the class: the first 32 hex of
   * `sha256("<64-hex digest>.<extension>")`.
   */
  const expectedKey = (digest: string, extension: string) =>
    createHash("sha256")
      .update(`${digest}.${extension}`)
      .digest("hex")
      .slice(0, 32);

  it("digests the raw bytes with SHA-256, all 64 hex characters", async ({
    expect,
  }) => {
    // FIPS 180-2 test vectors.
    expect(await manifest.digest(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await manifest.digest(bytes("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await manifest.digest(bytes("hello"))).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("derives the 32-hex key from the digest and the extension", async ({
    expect,
  }) => {
    const digest = await manifest.digest(bytes("export default 1;\n"));

    expect(await manifest.cloudflareKey(digest, "assets/app.js")).toBe(
      expectedKey(digest, "js"),
    );
    expect(
      await manifest.hash(bytes("export default 1;\n"), "assets/app.js"),
    ).toBe(expectedKey(digest, "js"));
    expect(await manifest.hash(bytes("x"), "a.css")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("reads the extension the way path.extname does", async ({ expect }) => {
    const digest = await manifest.digest(bytes("MIT"));
    const cases: Array<[string, string]> = [
      // No extension at all appends nothing after the dot.
      ["LICENSE", ""],
      // A dotfile is a NAME, not an extension.
      [".gitignore", ""],
      // A dot in a directory is not an extension of the file.
      ["dir.v2/README", ""],
      // Only the last one counts.
      ["assets/app.min.js", "js"],
      ["img\\logo.PNG", "PNG"],
    ];

    for (const [path, extension] of cases) {
      expect(await manifest.cloudflareKey(digest, path), path).toBe(
        expectedKey(digest, extension),
      );
    }
  });

  it("keys the same bytes apart under two extensions, and together under one", async ({
    expect,
  }) => {
    // Cloudflare stores a part's Content-Type with its key, so `logo.svg` and
    // `logo.txt` holding the same bytes must not share one.
    const svg = await manifest.hash(bytes("<svg/>"), "logo.svg");
    const txt = await manifest.hash(bytes("<svg/>"), "logo.txt");
    const elsewhere = await manifest.hash(bytes("<svg/>"), "deep/other.svg");

    expect(svg).not.toBe(txt);
    expect(svg).toBe(elsewhere);
  });

  it("hashes files past any chunk size as a whole", async ({ expect }) => {
    // A fixed linear congruential sequence: bytes that look like a binary
    // asset, identical on every run.
    const bytesOf = (length: number, seed: number): Uint8Array => {
      const out = new Uint8Array(length);
      let state = seed;
      for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        out[i] = state >>> 24;
      }
      return out;
    };

    for (const length of [0x8000 - 1, 0x8000, 0x8000 + 1, 250_000]) {
      const body = bytesOf(length, length);
      expect(await manifest.digest(body)).toBe(
        createHash("sha256").update(body).digest("hex"),
      );
    }
  });

  it("keys an asset by its served path", async ({ expect }) => {
    expect(manifest.key("index.html")).toBe("/index.html");
    expect(manifest.key("assets/app.js")).toBe("/assets/app.js");
    // Already absolute, and Windows separators, both normalised rather than
    // doubled - a `//index.html` key is a 404 nobody would look for here.
    expect(manifest.key("/index.html")).toBe("/index.html");
    expect(manifest.key("assets\\app.js")).toBe("/assets/app.js");
  });

  it("builds a manifest of hash and size", async ({ expect }) => {
    const built = await manifest.build([
      { path: "index.html", bytes: bytes("hello") },
    ]);

    expect(Object.keys(built)).toEqual(["/index.html"]);
    expect(built["/index.html"].size).toBe(5);
    expect(built["/index.html"].hash).toBe(
      expectedKey(await manifest.digest(bytes("hello")), "html"),
    );
  });

  describe("base64 for the upload (#Q3382)", () => {
    class Fallback extends CloudflareAssetManifest {
      public fallback(bytes: Uint8Array): string {
        return this.base64Fallback(bytes);
      }
    }

    it("is standard base64, natively and on the fallback, past the chunk size", ({
      expect,
    }) => {
      const fallback = new Fallback();
      for (const length of [0, 1, 2, 3, 0x8000 + 1, 100_000]) {
        const body = new Uint8Array(length).map((_, i) => (i * 31) & 0xff);
        const expected = Buffer.from(body).toString("base64");

        expect(manifest.base64(body), `native ${length}`).toBe(expected);
        expect(fallback.fallback(body), `fallback ${length}`).toBe(expected);
      }
    });
  });
});
