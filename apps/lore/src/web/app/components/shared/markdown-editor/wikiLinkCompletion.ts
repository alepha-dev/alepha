import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";

import type { WikiLinkSuggestion } from "../../folios/editor/wikilink/wikiLinkSuggestion.ts";

/**
 * How many entries the picker shows. Eight is what the Lexical typeahead it
 * replaced showed, so the list still fits without scrolling.
 */
const MAX_OPTIONS = 8;

/**
 * A completion source that always answers synchronously.
 *
 * CodeMirror's own `CompletionSource` permits returning a promise, which
 * widens every call site's result to `Promise<CompletionResult | null>` and
 * makes the value unusable without narrowing. This source reads an in-memory
 * array and never awaits anything, so the narrower type is the true one —
 * and keeping it narrow is deliberate: an async source would let the picker
 * resolve a keystroke late and flicker over text the author has moved past.
 *
 * Still assignable to `CompletionSource` wherever CodeMirror wants one.
 */
export type SyncCompletionSource = (
  context: CompletionContext,
) => CompletionResult | null;

/**
 * The `[[` picker as a CodeMirror completion source.
 *
 * Suggestions are read through a getter rather than captured, because the
 * project's folio / quest / epic lists change while the editor stays mounted
 * — a folio is created in the tree, a file is uploaded — and a captured
 * array would freeze at first render. The deleted Lexical plugin took its
 * context through a ref for exactly the same reason.
 */
export const createWikiLinkCompletion = (
  getSuggestions: () => WikiLinkSuggestion[],
): SyncCompletionSource => {
  return (context: CompletionContext): CompletionResult | null => {
    // `[[` followed by anything that is not a closing bracket or a newline.
    // Excluding `]` is what stops the picker reopening over an already
    // complete `[[#F12]]`; excluding `\n` keeps an unclosed `[[` at
    // the end of a line from swallowing the paragraph below it.
    const before = context.matchBefore(/\[\[[^\]\n]*/);
    if (!before) return null;

    const query = before.text.slice(2).toLowerCase();
    const options: Completion[] = getSuggestions()
      .filter((suggestion) => {
        if (!query) return true;
        return (
          suggestion.label.toLowerCase().includes(query) ||
          suggestion.token.toLowerCase().includes(query)
        );
      })
      .slice(0, MAX_OPTIONS)
      .map((suggestion) => ({
        label: suggestion.label,
        detail: suggestion.hint,
        type: suggestion.kind,
        // Closes the token off, so accepting a suggestion leaves a complete
        // `[[…]]` rather than an unterminated one that the resolver would
        // read as prose and never turn into a link.
        apply: `${suggestion.token}]]`,
      }));

    if (!options.length) return null;

    return {
      // After the two opening brackets — they stay put, only the typed
      // query is replaced.
      from: before.from + 2,
      options,
      validFor: /^[^\]\n]*$/,
    };
  };
};
