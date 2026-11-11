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
 * ## Two hashes, kept apart (#Q3377)
 *
 * - **The asset digest**, {@link digest}: the full SHA-256 of the raw bytes, 64
 *   hex characters. It is what an asset list carries (Lore's CLI computes it
 *   at push) and what a body is checked against before it is uploaded.
 * - **The Cloudflare key**, {@link cloudflareKey}: the 32 hex characters a
 *   Workers upload session is negotiated with, derived from the digest and
 *   the extension, so it costs one small hash and never a pass over the
 *   bytes.
 *
 * ⚠️ **The extension stays in the key.** Cloudflare stores each part's
 * `Content-Type` under the key it was uploaded with, so the same bytes served
 * as `logo.svg` and as `logo.txt` must not share one key: the second would be
 * served with the first one's type.
 *
 * ## ⚠️ Not wrangler's scheme, on purpose
 *
 * wrangler hashes `blake3(base64(bytes) + extension)`, and this class copied
 * it until #Q3377. Cloudflare does not verify the key: its Workers for
 * Platforms docs accept any consistent 32-hex hash. The copy cost a base64 of
 * every asset plus a pure-JS BLAKE3 (`crypto.subtle` has none), measured at
 * ~1.5 s each on the docs site against ~40 ms for native SHA-256 (folio
 * #F1484). What it bought was sharing assets with a `wrangler deploy` of the
 * same script, which no Alepha deploy path does.
 *
 * The cost of the switch is paid once: a script's first deploy after it
 * re-uploads every asset, since no key matches the old ones.
 *
 * ## ⚠️ A wrong key fails silently
 *
 * Nothing errors when the scheme drifts between two deployers: Cloudflare
 * simply never recognises a file it already holds, so every deploy re-uploads
 * everything. The laptop deploy (`WorkerCloudflareAdapter`) and Lore's deploy
 * use this one class, so they move together.
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
   * Whether a manifest key names one of the files Cloudflare reads as
   * configuration rather than serves: `/_headers`, `/_redirects` and
   * `/.assetsignore`, at the root of the assets directory only.
   *
   * ## ⚠️ Uploaded as an asset, the file is published and never applied
   *
   * wrangler leaves these three out of the upload (its default ignore list in
   * `createAssetsIgnoreFunction`, anchored at the root) and sends the text of
   * `_headers` and `_redirects` as `metadata.assets.config`. A deploy that
   * lists them in the manifest instead serves `https://<site>/_headers` as a
   * page with the file's text, and applies none of its rules. That is what
   * `alepha.dev` did from 2026-09-08 to epic #E49.
   */
  public isConfigFile(key: string): boolean {
    return CloudflareAssetManifest.CONFIG_FILES.includes(key);
  }

  /**
   * The field of the asset config a configuration file's text travels under,
   * or `undefined` for a file whose text goes nowhere.
   *
   * `/.assetsignore` answers `undefined`: wrangler reads it locally to extend
   * its ignore list and never sends it.
   */
  public configField(key: string): "_headers" | "_redirects" | undefined {
    if (key === "/_headers") {
      return "_headers";
    }
    if (key === "/_redirects") {
      return "_redirects";
    }
    return undefined;
  }

  protected static readonly CONFIG_FILES: readonly string[] = [
    "/_headers",
    "/_redirects",
    "/.assetsignore",
  ];

  /**
   * The asset digest: the full SHA-256 of the raw bytes, as 64 lowercase hex
   * characters, by the runtime's native crypto.
   *
   * ⚠️ `crypto.subtle`, not `node:crypto`: this class reaches Lore's Worker
   * through `alepha/cli/infra-lib`'s workerd entry, which admits no `node:`
   * builtin beyond `node:async_hooks` (`workerdEntryGraph.spec.ts`). The two
   * are equally native, 18 against 20 ms for 50 MB on local workerd (folio
   * #F1484); the only cost is that the answer is a promise.
   */
  public async digest(bytes: Uint8Array): Promise<string> {
    return this.hex(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes as BufferSource),
      ),
    );
  }

  /**
   * The 32-hex key a Workers upload session knows an asset by, derived from
   * its {@link digest} and its extension (#Q3377): the first 32 hex
   * characters of `sha256(<digest>.<extension>)`, the extension without its
   * dot and empty when there is none.
   *
   * Cheap on purpose: it hashes 70 bytes, never the asset, so a deploy holding
   * a pushed asset list derives every key without reading a file.
   */
  public async cloudflareKey(digest: string, path: string): Promise<string> {
    const payload = new TextEncoder().encode(
      `${digest}.${this.extension(path)}`,
    );
    return (await this.digest(payload)).slice(0, 32);
  }

  /**
   * The Cloudflare key of these bytes at this path: {@link cloudflareKey} of
   * their {@link digest}.
   */
  public async hash(bytes: Uint8Array, path: string): Promise<string> {
    return await this.cloudflareKey(await this.digest(bytes), path);
  }

  /**
   * The whole manifest, keyed by served path.
   */
  public async build(
    files: Array<{ path: string; bytes: Uint8Array }>,
  ): Promise<Record<string, CloudflareAssetEntry>> {
    const manifest: Record<string, CloudflareAssetEntry> = {};
    for (const file of files) {
      manifest[this.key(file.path)] = {
        hash: await this.hash(file.bytes, file.path),
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
   * ⚠️ The table is small on purpose. It covers what a built web app ships,
   * and a missing entry costs one asset its type; pulling in a full MIME
   * database costs every deploy its bundle size, inside a Worker.
   *
   * ⚠️ **The fallback is `application/null`, and it is not a mistake.** It is
   * wrangler's, and its own comment explains why: a form-data encoder
   * replaces a falsy type with `application/octet-stream`, so there is no way
   * to say "no type" by omission, and the API parses this exact string to
   * mean send no `Content-Type` at all. Answering `octet-stream` here would
   * instead pin an extensionless file to a type that makes a browser download
   * it.
   */
  public contentType(path: string): string {
    return (
      CloudflareAssetManifest.CONTENT_TYPES[
        this.extension(path).toLowerCase()
      ] ?? "application/null"
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
