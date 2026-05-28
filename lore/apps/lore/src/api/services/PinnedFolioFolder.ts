/**
 * Fold a list of pinned, non-protected folios into the `pinnedFolios`
 * payload surfaced by `campaign_context`. Newest-updated folios come
 * first (the caller is expected to pre-sort). The total character budget
 * across all included `content` is bounded by `cap`:
 *
 * - Folios that fit get included whole.
 * - The first folio that doesn't fit is included with its content cut
 *   to the remaining budget (`truncatedAt` records the cut point so
 *   renderers can mark it).
 * - Anything after a truncated folio is dropped and the
 *   `pinnedFoliosTruncated` flag is set so the agent knows to fall back
 *   to `folio_get` for the rest.
 *
 * Extracted as a pure function so the cap logic can be unit-tested
 * without exercising the MCP transport.
 */
export interface PinnedFolioInput {
  id: string;
  shortId: number;
  title: string;
  content: string;
}

export interface PinnedFolioOutput extends PinnedFolioInput {
  truncatedAt?: number;
}

export interface PinnedFoldResult {
  pinnedFolios: PinnedFolioOutput[];
  pinnedFoliosTruncated: boolean;
}

export const foldPinnedFolios = (
  source: readonly PinnedFolioInput[],
  cap: number,
): PinnedFoldResult => {
  const pinnedFolios: PinnedFolioOutput[] = [];
  let usedChars = 0;
  let truncated = false;
  for (const folio of source) {
    const remaining = cap - usedChars;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (folio.content.length <= remaining) {
      pinnedFolios.push(folio);
      usedChars += folio.content.length;
      continue;
    }
    pinnedFolios.push({
      ...folio,
      content: folio.content.slice(0, remaining),
      truncatedAt: remaining,
    });
    usedChars = cap;
    if (source.length > pinnedFolios.length) {
      truncated = true;
    }
    break;
  }
  return { pinnedFolios, pinnedFoliosTruncated: truncated };
};
