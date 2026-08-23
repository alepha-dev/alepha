import type { ZipEntry } from "alepha/system";

/**
 * One attachment's bytes, already fetched.
 */
export interface FolioZipAttachment {
  name: string;
  mimeType: string;
  data: Uint8Array<ArrayBuffer>;
}

/**
 * Extensions whose bytes are already compressed. Deflating these gains a
 * percent or two for real CPU, so they are STORED instead.
 *
 * Checked alongside the MIME type rather than instead of it: `mimeType`
 * comes from the framework `files` row and is trustworthy for anything
 * uploaded through the app, but the extension is what a human reads.
 */
const COMPRESSED_EXTENSIONS = new Set([
  "webp",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "avif",
  "mp4",
  "webm",
  "mov",
  "mp3",
  "zip",
  "gz",
  "pdf",
]);

/**
 * Build the entries of a folio's `.zip` export.
 *
 * Layout is the folio's markdown at the root and its attachments under
 * `assets/`, which is **exactly what the stored content already refers
 * to** — so nothing is rewritten on the way out. An unzipped folio opens
 * correctly in any markdown viewer, with no Lore in the loop. That property
 * is the whole reason `assets/<name>` was chosen as the reference form.
 *
 * Pure, and separate from the fetching, so the layout can be asserted
 * without a network.
 */
export const folioZipEntries = (input: {
  /**
   * Base filename, no extension — from `folioExportFilename`.
   */
  filename: string;
  markdown: string;
  attachments: FolioZipAttachment[];
}): ZipEntry[] => {
  const entries: ZipEntry[] = [
    {
      name: `${input.filename}.md`,
      data: new TextEncoder().encode(input.markdown),
      // Markdown deflates by roughly 70%; it is the one entry worth it.
      method: "deflate",
    },
  ];

  for (const attachment of input.attachments) {
    entries.push({
      name: `assets/${attachment.name}`,
      data: attachment.data,
      method: isAlreadyCompressed(attachment) ? "store" : "deflate",
    });
  }

  return entries;
};

/**
 * Whether an attachment's bytes are already compressed.
 */
const isAlreadyCompressed = (attachment: FolioZipAttachment): boolean => {
  const mime = attachment.mimeType.toLowerCase();
  if (
    mime.startsWith("image/") ||
    mime.startsWith("video/") ||
    mime.startsWith("audio/")
  ) {
    // SVG is XML — it is an image MIME that deflates extremely well.
    if (mime !== "image/svg+xml") return true;
    return false;
  }
  const extension = attachment.name.split(".").pop()?.toLowerCase();
  return !!extension && COMPRESSED_EXTENSIONS.has(extension);
};
