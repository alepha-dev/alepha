import type { Completion, CompletionContext } from "@codemirror/autocomplete";

import { mentionPattern } from "@/web/app/services/mentions.ts";

import type { SyncCompletionSource } from "./wikiLinkCompletion.ts";

/**
 * How many handles the picker shows. Same eight as the `[[` picker, so the
 * two lists behave alike and neither needs scrolling.
 */
const MAX_OPTIONS = 8;

/**
 * The `@` picker as a CodeMirror completion source.
 *
 * ⚠️ **The match is DERIVED from `mentionPattern()`, never written again.**
 * That pattern is what `expandCommentReferences` uses to turn a handle into
 * a link and what `MentionNotifier` uses to decide who gets pinged, and a
 * third regex here is how a picker comes to offer a completion the renderer
 * will not link and the notifier will not deliver. Reusing the SOURCE means
 * the three cannot drift: a change to what counts as a mention changes what
 * this offers in the same edit.
 *
 * A consequence worth naming: the pattern requires at least one character
 * after the `@` (`[\w.-]+`), so a bare `@` opens nothing. That is the same
 * rule feedback #2112 imposed on the `[[` picker, arrived at for free rather
 * than decided again - a popup that appears the instant you type a symbol is
 * a popup between the author and their text.
 *
 * ⚠️ **Scoped by the CALLER, and it has to be.** A mention only means
 * something where `expandCommentReferences` runs and `MentionNotifier`
 * reads: quest comments and feedback comments. In a quest description, an
 * epic description or a folio body an `@name` links nowhere and pings
 * nobody, so offering the picker there would manufacture exactly the
 * asymmetry `ReleaseDescriptionEditor` refuses `[[` for. This source is
 * mounted only when a caller supplies handles.
 *
 * Handles are read through a getter rather than captured: the project's
 * member list arrives asynchronously and a captured array would freeze empty
 * at first render, which is the same reason the `[[` source takes one.
 */
export const createMentionCompletion = (
  getHandles: () => string[],
): SyncCompletionSource => {
  return (context: CompletionContext) => {
    // Anchored at the cursor by `matchBefore`; the `$` says so explicitly.
    const before = context.matchBefore(
      new RegExp(`${mentionPattern().source}$`),
    );
    if (!before) return null;

    // Re-run against the matched text to name the two groups. `matchBefore`
    // hands back the text and the offset, not the groups.
    const parts = before.text.match(new RegExp(`^${mentionPattern().source}$`));
    if (!parts) return null;

    // ⚠️ The pattern's first group is the character BEFORE the `@` - it is
    // what keeps `me@example.com` from mentioning `@example` - so it is part
    // of the match and must not be part of what is replaced. It is empty
    // only at the very start of a line.
    const lead = parts[1] ?? "";
    const query = (parts[2] ?? "").toLowerCase();

    const options: Completion[] = getHandles()
      .filter((handle) => handle.toLowerCase().includes(query))
      .slice(0, MAX_OPTIONS)
      .map((handle) => ({
        label: handle,
        type: "variable",
        // The display name, because that is what `resolveMention` compares
        // against. Inserting anything else - an id, an email - produces a
        // handle that looks accepted and resolves to nobody.
        apply: handle,
      }));

    if (!options.length) return null;

    return {
      // Past the lead character and past the `@`: the sigil stays, only the
      // typed handle is replaced.
      from: before.from + lead.length + 1,
      options,
      // ⚠️ Ours is the only filter, for the same reason the `[[` source says
      // so: CodeMirror's own pass would re-match the text from `from` against
      // each option's label, and the two filters can only ever subtract.
      filter: false,
      // `+`, not `*`: backspacing back to a bare `@` closes the picker
      // rather than leaving it open over the whole roster.
      validFor: /^[\w.-]+$/,
    };
  };
};
