import type { DocNode } from "../config/docs.ts";

// =============================================================================
// TYPES
// =============================================================================

export interface SearchableDoc {
  name: string;
  href: string;
  keywords: string[];
  keywordsJoined: string;
}

// =============================================================================
// HELPERS
// =============================================================================

/** Flatten the doc tree to get all docs with hrefs */
export const flattenTree = (nodes: DocNode[]): SearchableDoc[] => {
  const result: SearchableDoc[] = [];
  for (const node of nodes) {
    if (node.href) {
      result.push({
        name: node.name,
        href: node.href,
        keywords: node.keywords || [],
        keywordsJoined: (node.keywords || []).join(" "),
      });
    }
    if (node.children) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
};

/** Find the best matching keyword for display */
export const findMatchedKeyword = (
  doc: SearchableDoc,
  query: string,
): string | null => {
  if (!query) return null;
  const q = query.toLowerCase();

  // Don't show keyword match if name or path already matches
  if (doc.name.toLowerCase().includes(q)) return null;
  if (doc.href.toLowerCase().includes(q)) return null;

  // Find matching keywords
  const matches = doc.keywords.filter((kw) => kw.toLowerCase().includes(q));
  if (!matches.length) return null;

  // Return shortest match (most specific)
  return matches.sort((a, b) => a.length - b.length)[0];
};
