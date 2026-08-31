/**
 * Builds the thing `alepha pack` produces, so the registry's specs can push a
 * real artifact instead of a shape that agrees with the reader by accident.
 *
 * A fake that mirrors the parser it is fed to can never disagree with it. This
 * writes actual ustar headers with actual checksums and actual gzip, so a
 * reader that stops understanding tar goes red here rather than in production.
 */

/**
 * One tar block, and the alignment every entry body is padded to.
 */
const BLOCK = 512;

/**
 * A NUL-padded fixed-width header field.
 */
const field = (value: string, width: number): Uint8Array => {
  const out = new Uint8Array(width);
  out.set(new TextEncoder().encode(value).subarray(0, width));
  return out;
};

/**
 * A tar numeric field: zero-padded octal, NUL-terminated.
 */
const octal = (value: number, width: number): Uint8Array =>
  field(value.toString(8).padStart(width - 1, "0"), width);

/**
 * One ustar header block, checksum included.
 *
 * The checksum is computed over the header with its own field written as eight
 * spaces, which is what the format says and what every real tar does. Getting
 * it wrong would not fail here - nothing in Lore verifies it - so it is done
 * properly to keep the fixture honest against tools that do.
 */
const header = (name: string, size: number): Uint8Array => {
  const block = new Uint8Array(BLOCK);
  block.set(field(name, 100), 0);
  block.set(octal(0o644, 8), 100);
  block.set(octal(0, 8), 108);
  block.set(octal(0, 8), 116);
  block.set(octal(size, 12), 124);
  block.set(octal(0, 12), 136);
  block.set(field("        ", 8), 148);
  block.set(field("0", 1), 156);
  block.set(field("ustar", 6), 257);
  block.set(field("00", 2), 263);

  let sum = 0;
  for (const byte of block) sum += byte;
  block.set(field(`${sum.toString(8).padStart(6, "0")}\0 `, 8), 148);
  return block;
};

/**
 * An uncompressed tar of the given entries, terminated the way tar terminates
 * one: two zeroed blocks.
 */
export const tar = (entries: Record<string, string>): Uint8Array => {
  const parts: Uint8Array[] = [];
  for (const [name, content] of Object.entries(entries)) {
    const body = new TextEncoder().encode(content);
    parts.push(header(name, body.length));
    const padded = Math.ceil(body.length / BLOCK) * BLOCK;
    const block = new Uint8Array(padded);
    block.set(body);
    parts.push(block);
  }
  parts.push(new Uint8Array(BLOCK * 2));

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/**
 * `tar`, gzipped.
 *
 * `CompressionStream` rather than `node:zlib`, so the fixture runs unchanged
 * under vitest, under bun and in any runtime the specs are ever pointed at.
 */
export const gzip = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/**
 * A packed app, as a `File` ready to hand to the push endpoint.
 *
 * The manifest defaults to the smallest thing `artifactManifestSchema`
 * accepts. Overriding it with `null` omits `dist/manifest.json` entirely,
 * which is a different failure from carrying a bad one and gets its own test.
 */
export const packedArtifact = async (
  options: {
    manifest?: Record<string, unknown> | null;
    /**
     * Extra bytes, so two artifacts with the same manifest can still differ in
     * sha256 - which is the whole distinction between a re-push and a
     * conflict.
     */
    filler?: string;
    /**
     * The filename. Deliberately settable: a filename that disagrees with the
     * manifest must change nothing about where the artifact lands.
     */
    name?: string;
    type?: string;
  } = {},
): Promise<File> => {
  const manifest =
    options.manifest === undefined
      ? { version: 1, runtime: "node", project: "my-app", entry: "dist" }
      : options.manifest;

  const entries: Record<string, string> = {
    "dist/index.js": `console.log("hello");${options.filler ?? ""}`,
  };
  if (manifest !== null) {
    entries["dist/manifest.json"] = JSON.stringify(manifest);
  }

  const bytes = await gzip(tar(entries));
  return new File([bytes as BlobPart], options.name ?? "my-app-latest.tar.gz", {
    type: options.type ?? "application/gzip",
  });
};
