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
    // `[[#` followed by AT LEAST ONE character that is not a closing bracket
    // or a newline.
    //
    // The `#` and the `+` are the whole of feedback #2112: on a bare `[[`
    // this used to match, and the filter's `if (!query) return true` then
    // opened the picker over the first eight suggestions before the author
    // had said what they were looking for. While writing markdown that is a
    // popup between you and the text. `#` is the moment the author declares
    // they are writing a reference, so it is the right moment to help.
    //
    // Excluding `]` is what stops the picker reopening over an already
    // complete `[[#F12]]`; excluding `\n` keeps an unclosed `[[` at
    // the end of a line from swallowing the paragraph below it.
    const before = context.matchBefore(/\[\[#[^\]\n]+/);
    if (!before) return null;

    // Past `[[#`, not past `[[`: the `#` is the signal, not part of what the
    // author is searching for. Dropping it is what keeps TITLE lookup alive
    // - no folio is called "#account", so filtering on a query that still
    // carried the hash would have matched tokens only and killed the label
    // branch silently.
    //
    // The match guarantees at least one character here, so there is no empty
    // query to special-case any more. That missing branch IS the fix.
    const query = before.text.slice(3).toLowerCase();
    const options: Completion[] = getSuggestions()
      .filter(
        (suggestion) =>
          suggestion.label.toLowerCase().includes(query) ||
          suggestion.token.toLowerCase().includes(query),
      )
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
      //
      // ⚠️ `+2`, NOT `+3`, even though the match now starts at `[[#`. A
      // suggestion's `token` IS the typed reference, `#Q12`, and `apply`
      // closes it with `]]`. Moving this past the hash to "skip" it would
      // leave the author's `#` in place and produce `[[##Q12]]`.
      from: before.from + 2,
      options,
      // ⚠️ OURS is the only filter. CodeMirror otherwise runs its own fuzzy
      // pass over the text between `from` and the cursor - which, because
      // `from` sits at the brackets, is `#host` and not `host` - and matches
      // it against each option's LABEL only. No folio is called "#host", so
      // every option was discarded AFTER this source had selected it, and
      // the picker rendered nothing at all.
      //
      // Not a new hazard introduced by requiring the `#`: it is also why
      // `[[#Q19` never opened the picker in the real editor before this
      // change. `token` is not something CodeMirror's matcher can see, so
      // token lookup only ever worked in the unit spec, which calls this
      // source directly. This source already filters on label AND token, so
      // the second pass could only ever subtract from it.
      filter: false,
      // ⚠️ Tightened in step with the match pattern, and it has to be: this
      // is what CodeMirror checks while the picker is ALREADY open, so the
      // loose `/^[^\]\n]*$/` kept it open after backspacing back to `[[` -
      // the exact state the new rule exists to exclude. The rule would have
      // held on the way in and not on the way out.
      //
      // Anchored against the text from `from`, which is everything after
      // `[[`, so it spells the hash itself rather than inheriting it.
      validFor: /^#[^\]\n]+$/,
    };
  };
};
