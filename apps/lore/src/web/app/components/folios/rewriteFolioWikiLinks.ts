import type { Folio } from "@/api/entities/folios.ts";
import {
  type BlobRef,
  createFolioWikiLinkResolver,
  type DirectoryRef,
  formatBlobBytes,
  isImageBlob,
  type QuestRef,
} from "./folioWikiLinkResolver.ts";

export {
  type BlobRef,
  BROKEN_HREF_PREFIX,
  type DirectoryRef,
} from "./folioWikiLinkResolver.ts";

/**
 * Rewrite `[[...]]` wiki-link tokens in folio markdown into standard
 * markdown anchor syntax so the existing `<a>` renderer in MarkdownView
 * handles them.
 *
 * This is the READ-ONLY half of wiki-links: markdown in, markdown out, for
 * `MarkdownView`. The editor (`editor/wikilink/`) never goes through here —
 * it decorates the token in place and leaves the markdown alone. Both call
 * `createFolioWikiLinkResolver`, which is where the resolution rules live
 * and the only place they are allowed to live: two implementations would
 * drift, and the reader would see a live link the editor calls broken.
 *
 * Unresolved references render as a "broken link" marker — a real markdown
 * link with a synthetic `lore-broken:<reason>` href that the hover-preview
 * wrapper styles distinctly and explains on hover (#107). The original
 * `[[...]]` text is preserved as the label so the author still sees what
 * they typed.
 */
export const rewriteFolioWikiLinks = (
  content: string,
  projectId: number,
  folios: Folio[],
  quests: QuestRef[],
  directories: DirectoryRef[] = [],
  blobs: BlobRef[] = [],
): string => {
  if (!content) return content;
  const hasWiki = content.includes("[[");
  const hasBlobImage = /!\[[^\]]*\]\(blob:/i.test(content);
  if (!hasWiki && !hasBlobImage) return content;

  const resolver = createFolioWikiLinkResolver({
    projectId,
    folios,
    quests,
    directories,
    blobs,
  });

  // Step 1 — rewrite `![alt](blob:#42)` / `![alt](blob:<uuid>)` image
  // syntax BEFORE the wiki-link pass. Image MIME → `<img>` URL.
  // Non-image MIME → a plain link with a paperclip + size annotation
  // (so non-image blobs degrade to a download link instead of a
  // broken-image placeholder).
  const rewritten = content.replace(
    /!\[([^\]]*)\]\(blob:([^)\s]+)\)/gi,
    (full, alt: string, ref: string) => {
      const blob = resolver.resolveBlob(ref);
      if (!blob) return full;
      const fileUrl = `/api/files/${blob.fileId}`;
      if (isImageBlob(blob)) {
        const safeAlt = alt || blob.name;
        return `![${safeAlt}](${fileUrl})`;
      }
      const sizeSuffix =
        blob.size != null ? ` (${formatBlobBytes(blob.size)})` : "";
      const label = escapeMarkdownLabel(`📎 ${blob.name}${sizeSuffix}`);
      return `[${label}](${fileUrl})`;
    },
  );

  if (!hasWiki) return rewritten;

  return rewritten.replace(/\[\[([^\]\n]+)\]\]/g, (_full, body: string) => {
    const target = resolver.resolve(body);
    // A blank token is not a reference — leave it exactly as typed.
    if (!target) return `[[${body}]]`;
    return `[${escapeMarkdownLabel(target.label)}](${target.href})`;
  });
};

/**
 * Escape characters that would break a markdown link label. Brackets are
 * the main concern; titles with literal `]` would terminate the label
 * early and leave the URL on the page as text.
 */
const escapeMarkdownLabel = (s: string): string =>
  s.replace(/[\\[\]]/g, (c) => `\\${c}`);
