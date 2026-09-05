import type { Folio } from "@/api/entities/folios.ts";

import {
  type BlobRef,
  BROKEN_HREF_PREFIX,
  createFolioWikiLinkResolver,
  type EpicRef,
  type FeedbackRef,
  formatBlobBytes,
  isImageBlob,
  type QuestRef,
  type ReleaseRef,
} from "./folioWikiLinkResolver.ts";
import { outsideMarkdownCode } from "./markdownCodeSegments.ts";

export {
  type BlobRef,
  BROKEN_HREF_PREFIX,
  type EpicRef,
  type FeedbackRef,
  type ReleaseRef,
} from "./folioWikiLinkResolver.ts";

/**
 * Rewrite `[[#Q12]]` reference tokens and `assets/<name>` attachment paths
 * in element markdown into standard markdown links so the existing `<a>`
 * renderer in MarkdownView handles them.
 *
 * This is the READ-ONLY half of wiki-links: markdown in, markdown out, for
 * `MarkdownView`. The editor never goes through here — it shows the token
 * as typed and leaves the markdown alone. Both call
 * `createFolioWikiLinkResolver`, which is where the resolution rules live
 * and the only place they are allowed to live: two implementations would
 * drift, and the reader would see a live link the editor calls broken.
 *
 * Unresolved references render as a "broken link" marker — a real markdown
 * link with a synthetic `#lore-broken:<reason>` href that the hover-preview
 * wrapper styles distinctly and explains on hover (#107). The original
 * `[[...]]` text is preserved as the label so the author still sees what
 * they typed.
 */
export const rewriteFolioWikiLinks = (
  content: string,
  projectSlug: string,
  folios: Folio[],
  quests: QuestRef[],
  blobs: BlobRef[] = [],
  epics: EpicRef[] = [],
  feedback: FeedbackRef[] = [],
  releases: ReleaseRef[] = [],
): string => {
  if (!content) return content;
  const hasWiki = content.includes("[[");
  const hasAssets = /\]\(assets\//i.test(content);
  if (!hasWiki && !hasAssets) return content;

  const resolver = createFolioWikiLinkResolver({
    projectSlug,
    folios,
    quests,
    epics,
    blobs,
    feedback,
    releases,
  });

  // Every pass below is a regex over a raw string, and a regex cannot see a
  // code fence. Running them over the whole document turned `[[1, 2]]` in a
  // ```ts block into a broken-link marker, inside the `<pre>`, on every Lore
  // surface (#1261), and would corrupt a mermaid `A[[Sub]]` node before the
  // diagram parser ever saw it. So the passes only ever see prose.
  return outsideMarkdownCode(content, (segment) =>
    rewriteSegment(segment, resolver, { hasWiki, hasAssets }),
  );
};

/**
 * The two rewrites, over one stretch of prose. Split out only so
 * `outsideMarkdownCode` has something to call per segment.
 */
const rewriteSegment = (
  content: string,
  resolver: ReturnType<typeof createFolioWikiLinkResolver>,
  present: { hasWiki: boolean; hasAssets: boolean },
): string => {
  const { hasWiki, hasAssets } = present;

  // Step 0 — `assets/<name>`, the form folio markdown stores for an
  // attachment. Both the embed `![alt](assets/x.webp)` and the plain link
  // `[label](assets/x)` are rewritten, so an attachment can be shown or
  // linked.
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

  if (!hasWiki) return withAssets;

  // Step 1 — every `[[...]]` token. A blank one is not a reference and is
  // left exactly as typed; anything else resolves to a link or to a broken
  // marker, never back to prose.
  return withAssets.replace(/\[\[([^\]\n]+)\]\]/g, (_full, body: string) => {
    const target = resolver.resolve(body);
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
