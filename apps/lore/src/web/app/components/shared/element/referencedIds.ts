import { parseTypedReference, type ReferenceKind } from "./typedReference.ts";

/**
 * The per-project numbers of every `[[#<LETTER><n>]]` of one kind in a body,
 * ascending and without repeats: `referencedIds("see [[#Q9]] and [[#Q2]]",
 * "quest")` is `[2, 9]`.
 *
 * This is what the wiki-link resolver asks the server about (#Q2355). It
 * used to resolve against a page of the most recently updated rows, so an
 * older quest or folio rendered as a broken link; asking for the numbers the
 * body actually carries makes resolution independent of any page.
 *
 * The token pattern is the one `rewriteFolioWikiLinks` replaces, so a token
 * the reader renders is a token this finds. It does not skip code fences,
 * unlike the rewrite: a reference quoted in a fence only costs a title
 * nobody renders, and the ids are sorted so the query key stays the same
 * while the author edits prose around them.
 */
export const referencedIds = (
  content: string,
  kind: ReferenceKind,
): number[] => {
  if (!content.includes("[[")) return [];
  const ids = new Set<number>();
  for (const match of content.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const typed = parseTypedReference(match[1]);
    if (typed?.kind === kind) ids.add(typed.id);
  }
  return [...ids].sort((a, b) => a - b);
};
