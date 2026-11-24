/**
 * Turns a caller's free-text query into the `LIKE` conditions every folio
 * search runs (#Q4271).
 *
 * D1 refuses a `LIKE` pattern over 50 bytes ("LIKE or GLOB pattern too
 * complex"), and a query pasted by an agent is often a paragraph. So the query
 * is split into words, each word matched on its own and the matches ANDed,
 * at most `MAX_TERMS` words, each cut to fit the pattern limit once escaped
 * and wrapped in `%`. The ORM's `contains` operator does the escaping of `%`,
 * `_` and `\` (with `ESCAPE '\'`), so a wildcard in the query matches itself.
 */
export class FolioSearchTerms {
  /**
   * D1's (and a Durable Object's) cap on a `LIKE` pattern, in bytes.
   */
  static readonly MAX_PATTERN_BYTES = 50;

  /**
   * The words kept from a query: enough for any real search, few enough that
   * a pasted paragraph stays a cheap query.
   */
  static readonly MAX_TERMS = 8;

  protected readonly encoder = new TextEncoder();

  /**
   * The lowercased, deduplicated words of `query`, each short enough that
   * `%<escaped word>%` fits `MAX_PATTERN_BYTES`. Empty for a blank query.
   */
  terms(query: string): string[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const terms: string[] = [];
    for (const word of words) {
      const term = this.fit(word);
      if (term && !terms.includes(term)) terms.push(term);
      if (terms.length >= FolioSearchTerms.MAX_TERMS) break;
    }
    return terms;
  }

  /**
   * The where-conditions matching every term of `query` on `column`, to spread
   * into an `and`. Empty for a blank query.
   */
  conditions<K extends string>(
    column: K,
    query: string,
  ): Array<Record<K, { contains: string }>> {
    return this.terms(query).map(
      (term) =>
        ({ [column]: { contains: term } }) as Record<K, { contains: string }>,
    );
  }

  /**
   * The bytes `term` takes in the pattern, `%` on each side and each `%`, `_`
   * and `\` escaped by a backslash.
   */
  patternBytes(term: string): number {
    const escaped = term.replace(/[\\%_]/g, "\\$&");
    return this.encoder.encode(escaped).length + 2;
  }

  /**
   * Cuts `word` by whole code points until its pattern fits.
   */
  protected fit(word: string): string {
    const chars = Array.from(word);
    while (
      chars.length > 0 &&
      this.patternBytes(chars.join("")) > FolioSearchTerms.MAX_PATTERN_BYTES
    ) {
      chars.pop();
    }
    return chars.join("");
  }
}
