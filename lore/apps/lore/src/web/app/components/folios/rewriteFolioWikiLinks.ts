import type { Folio } from "@/api/entities/folios.ts";

import {
  type BlobRef,
  BROKEN_HREF_PREFIX,
  createFolioWikiLinkResolver,
  type DirectoryRef,
  type EpicRef,
  formatBlobBytes,
  isImageBlob,
  type QuestRef,
} from "./folioWikiLinkResolver.ts";
import { outsideMarkdownCode } from "./markdownCodeSegments.ts";

export {
  type BlobRef,
  BROKEN_HREF_PREFIX,
  type DirectoryRef,
  type EpicRef,
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
  projectSlug: string,
  folios: Folio[],
  quests: QuestRef[],
  directories: DirectoryRef[] = [],
  blobs: BlobRef[] = [],
  epics: EpicRef[] = [],
): string => {
  if (!content) return content;
  const hasWiki = content.includes("[[");
  const hasBlobImage = /!\[[^\]]*\]\(blob:/i.test(content);
  const hasAssets = /\]\(assets\//i.test(content);
  if (!hasWiki && !hasBlobImage && !hasAssets) return content;

  const resolver = createFolioWikiLinkResolver({
    projectSlug,
    folios,
    quests,
    epics,
    directories,
    blobs,
  });

  // Every pass below is a regex over a raw string, and a regex cannot see a
  // code fence. Running them over the whole document turned `[[1, 2]]` in a
  // ```ts block into a broken-link marker, inside the `<pre>`, on every Lore
  // surface (#1261), and would corrupt a mermaid `A[[Sub]]` node before the
  // diagram parser ever saw it. So the passes only ever see prose.
  return outsideMarkdownCode(content, (segment) =>
    rewriteSegment(segment, resolver, { hasWiki, hasBlobImage, hasAssets }),
  );
};

/**
 * The three rewrites, over one stretch of prose. Split out only so
 * `outsideMarkdownCode` has something to call per segment; the passes and
 * their order are exactly what they were when they ran over the whole
 * document.
 */
const rewriteSegment = (
  content: string,
  resolver: ReturnType<typeof createFolioWikiLinkResolver>,
  present: { hasWiki: boolean; hasBlobImage: boolean; hasAssets: boolean },
): string => {
  const { hasWiki, hasAssets } = present;

  // Step 0 — `assets/<name>`, the form folio markdown actually stores. Both
  // the embed `![alt](assets/x.webp)` and the plain link `[label](assets/x)`
  // are rewritten, so an attachment can be shown or linked. Runs before the
  // `blob:` pass below purely for readability; the two syntaxes cannot
  // overlap.
  //
  // Spaces ARE allowed in the name: hand-written markdown will not be
  // percent-encoded, and refusing those would resolve nothing for a file
  // called `my photo.webp`. `)` still terminates — that is markdown's own
  // rule, and why `folioAssetPath` encodes parentheses on the way in. The
  // trailing `(?: "[^"]*")?` swallows a markdown title.
  const withAssets = hasAssets
    ? content.replace(
        /(!?)\[([^\]]*)\]\(assets\/([^)\n"]+?)(?:\s+"[^"]*")?\)/gi,
        (full, bang: string, label: string, name: string) => {
          const blob = resolver.resolveBlobByName(decodeURIComponent(name));
          if (!blob) {
            // A missing attachment is reported the same way a missing folio
            // is, rather than left to render as a broken-image icon.
            return `[${escapeMarkdownLabel(full)}](${BROKEN_HREF_PREFIX}blob-not-found)`;
          }
          const fileUrl = `/api/files/${blob.fileId}`;
          // A plain link keeps the author's label whatever the type is —
          // only an EMBED of a non-image has to degrade, because there is no
          // image to show.
          if (!bang) return `[${label}](${fileUrl})`;
          if (isImageBlob(blob)) {
            return `![${escapeMarkdownLabel(label || blob.name)}](${fileUrl})`;
          }
          const sizeSuffix =
            blob.size != null ? ` (${formatBlobBytes(blob.size)})` : "";
          return `[${escapeMarkdownLabel(`📎 ${blob.name}${sizeSuffix}`)}](${fileUrl})`;
        },
      )
    : content;

  // Step 1 — rewrite `![alt](blob:#42)` / `![alt](blob:<uuid>)` image
  // syntax BEFORE the wiki-link pass. Image MIME → `<img>` URL.
  // Non-image MIME → a plain link with a paperclip + size annotation
  // (so non-image blobs degrade to a download link instead of a
  // broken-image placeholder).
  const rewritten = withAssets.replace(
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
