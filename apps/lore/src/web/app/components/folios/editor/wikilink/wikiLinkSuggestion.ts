/**
 * One entry the `[[` picker can offer.
 *
 * Lives in its own file because the Lexical plugin that used to declare it
 * is deleted. The shape is what `useElementLinks` produces and what the
 * CodeMirror completion source consumes, and neither of those is Lexical:
 * the type outliving the plugin is the point, not an accident.
 */
export interface WikiLinkSuggestion {
  key: string;
  kind: "folio" | "quest" | "epic";
  /**
   * What is written INTO the document, between the brackets: the typed
   * reference `#Q12` / `#E3` / `#F12` (`typedReference.ts`), for every kind.
   *
   * By number and never by title, on purpose. Quest and epic titles get
   * rewritten as the work is understood. Folios used to go by title so a
   * reference survived an export into another project; that portability was
   * given up for one grammar (epic #32). A number is rename-proof and needs
   * no rewriter behind it.
   */
  token: string;
  label: string;
  hint?: string;
}
