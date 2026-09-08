import { blake3 } from "@noble/hashes/blake3";

/**
 * One entry of the manifest Cloudflare answers an upload session for.
 */
export interface CloudflareAssetEntry {
  hash: string;
  size: number;
}

/**
 * The asset manifest a Workers deploy is negotiated with.
 *
 * ## ⚠️ The hash is undocumented, and getting it wrong fails silently
 *
 * Cloudflare's docs say only "a 32 hexadecimal character hash". wrangler's own
 * implementation, read out of `wrangler@4.127.1`'s `hashFile`, is:
 *
 * ```js
 * blake3(contents.toString("base64") + extname(filepath).substring(1))
 *   .toString("hex")
 *   .slice(0, 32)
 * ```
 *
 * Three details, each of which is a silent bug on its own:
 *
 * - it hashes the **base64 of the content**, not the content;
 * - it appends the extension **without its dot**, and an extensionless file
 *   appends nothing;
 * - it keeps the **first 32 hex characters**, which is 16 bytes of a 32-byte
 *   digest.
 *
 * Get any of them wrong and nothing errors: Cloudflare simply never recognises
 * a file it already holds, so every deploy re-uploads everything and a laptop
 * deploy and a Lore deploy never share an asset. The failure is a bill and a
 * latency, not an exception.
 *
 * ## Why `@noble/hashes` and not `crypto.subtle`
 *
 * `crypto.subtle` has no BLAKE3, and wrangler's `blake3-wasm` carries a wasm
 * binary and is Node-only. `@noble/hashes/blake3` is pure JS and runs in a
 * Worker. Verified byte-identical against `blake3-wasm` over the real
 * `apps/lore/dist/public` tree - see `CloudflareAssetManifest.spec.ts`.
 */
export class CloudflareAssetManifest {
  /**
   * How many bytes to convert to base64 at a time.
   *
   * `String.fromCharCode(...bytes)` with a whole file spread into it blows the
   * argument limit somewhere above ~100k entries, which is a stack overflow on
   * a file nobody would call large.
   */
  protected static readonly BASE64_CHUNK = 0x8000;

  /**
   * The manifest key for one file: always a leading slash, separators
   * normalised.
   *
   * Cloudflare keys assets by their served path, so the caller passes paths
   * relative to the assets root and the shape is fixed here, once.
   */
  public key(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    return `/${normalized}`;
  }

  /**
   * wrangler's `hashFile`, reproduced.
   */
  public hash(bytes: Uint8Array, path: string): string {
    const payload = `${this.base64(bytes)}${this.extension(path)}`;
    return this.hex(blake3(new TextEncoder().encode(payload))).slice(0, 32);
  }

  /**
   * The whole manifest, keyed by served path.
   */
  public build(
    files: Array<{ path: string; bytes: Uint8Array }>,
  ): Record<string, CloudflareAssetEntry> {
    const manifest: Record<string, CloudflareAssetEntry> = {};
    for (const file of files) {
      manifest[this.key(file.path)] = {
        hash: this.hash(file.bytes, file.path),
        size: file.bytes.length,
      };
    }
    return manifest;
  }

  /**
   * The MIME type Cloudflare should serve this asset as.
   *
   * ## ⚠️ Without it the browser refuses the file, and the page still renders
   *
   * The upload is `multipart/form-data`, and Cloudflare stores each part's
   * `Content-Type` as the one it serves the asset with. A part built from a
   * plain string carries none, so every asset comes back with an EMPTY
   * content type - and a module script with an empty MIME type is refused by
   * the browser under strict MIME checking, while the stylesheet beside it is
   * refused too.
   *
   * A prerendered site still looks correct at that point: the HTML is a file
   * on disk, so the page paints and only the JavaScript is missing. Measured
   * on `ui.alepha.dev`, where it read as "the deploy worked" for an hour.
   *
   * ⚠️ The table is small on purpose. It covers what a built web app ships
   * and answers `application/octet-stream` for anything else, which is what
   * an unknown download should be. A missing entry costs one asset its type;
   * pulling in a full MIME database costs every deploy its bundle size, in a
   * Worker.
   */
  public contentType(path: string): string {
    return (
      CloudflareAssetManifest.CONTENT_TYPES[
        this.extension(path).toLowerCase()
      ] ?? "application/octet-stream"
    );
  }

  protected static readonly CONTENT_TYPES: Record<string, string> = {
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    json: "application/json; charset=utf-8",
    webmanifest: "application/manifest+json",
    map: "application/json; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    xml: "application/xml; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    eot: "application/vnd.ms-fontobject",
    wasm: "application/wasm",
    pdf: "application/pdf",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    zip: "application/zip",
  };

  /**
   * The extension with no dot, and an empty string when there is none.
   *
   * ⚠️ Only a dot in the LAST segment counts, and only when it is not the
   * first character: `dir.v2/README` has no extension and `.gitignore` is a
   * name rather than an extension - which is what `path.extname` answers and
   * therefore what wrangler hashes.
   */
  protected extension(path: string): string {
    const name = path.replace(/\\/g, "/").split("/").pop() ?? "";
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot + 1) : "";
  }

  /**
   * Standard base64 of raw bytes, without `Buffer`.
   *
   * `btoa` is defined in workerd and in Node, and takes a binary string, so
   * the bytes are widened one chunk at a time.
   */
  public base64(bytes: Uint8Array): string {
    let binary = "";
    for (
      let i = 0;
      i < bytes.length;
      i += CloudflareAssetManifest.BASE64_CHUNK
    ) {
      const chunk = bytes.subarray(i, i + CloudflareAssetManifest.BASE64_CHUNK);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  protected hex(bytes: Uint8Array): string {
    let out = "";
    for (const byte of bytes) {
      out += byte.toString(16).padStart(2, "0");
    }
    return out;
  }
}
