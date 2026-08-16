/**
 * One entry the `[[` picker can offer.
 *
 * Lives in its own file because the Lexical plugin that used to declare it
 * is deleted. The shape is what `useWikiLinkEditorContext` produces and what
 * the CodeMirror completion source consumes, and neither of those is Lexical
 * — so the type outliving the plugin is the point, not an accident.
 */
export interface WikiLinkSuggestion {
  key: string;
  kind: "folio" | "quest" | "blob";
  /**
   * What is written INTO the document, between the brackets.
   *
   * A folio goes by title: a reference written by title survives an
   * export/import into another project, and reads in the source. A quest
   * goes by `quest#N` instead, because quest titles get rewritten as the
   * work is understood and a title-keyed reference silently breaks when they
   * do — whereas a folio's title IS its identity and is renamed far less.
   */
  token: string;
  label: string;
  hint?: string;
}
