import type { Folio } from "@/api/entities/folios.ts";

/**
 * What {@link folioMarkdownExport} needs. Widened from the brief's stated
 * `Pick<Folio, "title" | "shortId" | "tags" | "summary" | "content" |
 * "createdAt" | "updatedAt">` to also carry `pinned` (optional): the
 * frontmatter this function writes has always included a `pinned: true|false`
 * line (see below), and the narrower `Pick` would make that line either a
 * type error (reading a property the type doesn't declare) or, if worked
 * around, silently print `pinned: false` for every folio regardless of its
 * real state. `pinned` is optional so a caller with a narrower object still
 * compiles — omission renders `false`, matching the un-narrowed behavior for
 * a caller that truly doesn't have the field.
 */
export type FolioMarkdownExportInput = Pick<
  Folio,
  | "title"
  | "shortId"
  | "tags"
  | "summary"
  | "content"
  | "createdAt"
  | "updatedAt"
> & {
  pinned?: boolean;
};

/**
 * Build the markdown export for a folio. YAML frontmatter on top with the
 * metadata we keep (shortId, title, tags, summary, createdAt, updatedAt,
 * pinned). Body is the original markdown content.
 *
 * Extracted verbatim from `FolioBrowser.tsx`'s `buildFolioMarkdown` (moved,
 * not rewritten) so both the folio browser's row-level download and the
 * document workspace's `folio.export` action produce byte-identical output.
 */
export const folioMarkdownExport = (
  folio: FolioMarkdownExportInput,
): string => {
  const escapeYaml = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const lines = ["---"];
  lines.push(`shortId: ${folio.shortId}`);
  lines.push(`title: "${escapeYaml(folio.title)}"`);
  if (folio.tags && folio.tags.length > 0) {
    lines.push(
      `tags: [${folio.tags.map((t) => `"${escapeYaml(t)}"`).join(", ")}]`,
    );
  } else {
    lines.push("tags: []");
  }
  if (folio.summary?.trim()) {
    lines.push(`summary: "${escapeYaml(folio.summary.trim())}"`);
  }
  lines.push(`pinned: ${folio.pinned ? "true" : "false"}`);
  lines.push(`createdAt: ${folio.createdAt}`);
  lines.push(`updatedAt: ${folio.updatedAt}`);
  lines.push("---", "");
  lines.push(folio.content ?? "");
  return lines.join("\n");
};

/**
 * Drive-safe filename slug — keep letters, digits, dot, dash, underscore;
 * collapse anything else to underscore. Lowercased. Moved alongside
 * `folioMarkdownExport` (not part of the brief's stated export, but both
 * `FolioBrowser`'s download action and the document workspace's
 * `folio.export` need an identical filename policy, so co-locating avoids a
 * second, possibly-drifting copy).
 */
export const folioExportFilename = (title: string): string =>
  (title.trim() || "folio")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100) || "folio";

/**
 * Browser-side download trigger via an in-memory blob URL. Works
 * synchronously, no server round-trip. Same reasoning as
 * {@link folioExportFilename} for living here.
 */
export const triggerFolioDownload = (
  filename: string,
  body: string,
  mime: string,
): void => {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
