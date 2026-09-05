import {
  formatReference,
  parseTypedReference,
} from "../../shared/element/typedReference.ts";

/**
 * Expands the two reference shapes that belong to comments alone, into
 * markdown the shared element-link resolver already understands.
 *
 * ## Why not extend the resolver itself
 *
 * `useElementLinks` / `rewriteFolioWikiLinks` render `[[...]]` on every
 * element that carries markdown. Teaching THAT to rewrite a bare `#Q1204`
 * would turn every reference quoted in a folio's prose into a link, and a
 * document quotes a reference without pointing at it. The bare form is a
 * convention of conversation, so it is expanded here, on the way in, and
 * handed to the same resolver as `[[#Q1204]]`. One resolver, two entry
 * points. Nothing is forked.
 *
 * ## What is left alone
 *
 * Code spans and fenced blocks pass through untouched: a comment explaining
 * `#include` or an `@decorator` must not sprout links. So does anything
 * already inside a markdown link's target or a `[[...]]` of its own. And an
 * untyped `#1204` is plain text now: it names no kind, and guessing "quest"
 * was the ambiguity epic #32 removed.
 */
export const expandCommentReferences = (
  body: string,
  options: CommentReferenceOptions,
): string => {
  return outsideProtected(body, (segment) =>
    expandMentions(expandTypedRefs(segment), options),
  );
};

export interface CommentReferenceOptions {
  /**
   * The project's URL identity, for the mention link.
   */
  projectSlug: string;
  /**
   * Project members, as the mention list to match `@name` against.
   */
  members: Array<{ name: string }>;
}

/**
 * Runs `fn` over the parts of the markdown that must not be rewritten.
 *
 * Four shapes are held out verbatim: fenced blocks, inline code spans, an
 * existing `[[…]]` (or the expansion double-wraps its own output), and a
 * markdown link's target (or `](/docs/page#42)` becomes a quest reference).
 * Everything else is expanded.
 */
const outsideProtected = (
  input: string,
  fn: (segment: string) => string,
): string =>
  input
    .split(/(```[\s\S]*?```|`[^`\n]*`|\[\[[^\]\n]*\]\]|\]\([^)\n]*\))/g)
    .map((part, index) => (index % 2 === 1 ? part : fn(part)))
    .join("");

/**
 * A bare typed reference (`#Q1204`, `#E3`, `#F12`, `#P120`, `#R7`) becomes
 * `[[#Q1204]]`, which the shared resolver turns into a real link carrying
 * the target's title. The letter is what makes it safe to expand, and the
 * letter set is the grammar's own (`typedReference.ts`), so a kind added
 * there is expandable here without a second list. Case-insensitive on the
 * way in, uppercase on the way out, like the bracketed form.
 *
 * This is the one place the `#F12` hex-colour collision is real: a colour
 * typed bare in comment prose becomes a folio link. Code spans are held out,
 * and the epic accepts the rest.
 */
const expandTypedRefs = (segment: string): string =>
  segment.replace(
    // A heading is `#` followed by a space, so a letter right after it is a
    // reference either way. The two shapes that would otherwise match,
    // `[[#Q12]]` and `](#Q12)`, are held out by `outsideProtected`.
    /(^|[^\w#/])#([A-Za-z])(\d+)\b/g,
    (match, prefix: string, letter: string, id: string) => {
      const typed = parseTypedReference(`#${letter}${id}`);
      if (!typed) return match;
      return `${prefix}[[${formatReference(typed.kind, typed.id)}]]`;
    },
  );

/**
 * `@name` becomes a link when it matches a project member, and stays plain
 * text when it does not — an unmatched mention is a typo or an email
 * address, and neither should render as a live link.
 *
 * The destination is the project's members page: Lore has no per-member
 * page, and "who is that?" is the question a mention actually raises.
 */
const expandMentions = (
  segment: string,
  options: CommentReferenceOptions,
): string => {
  if (options.members.length === 0) return segment;

  return segment.replace(
    /(^|[^\w@/])@([\w.-]+)/g,
    (match, prefix: string, handle: string) => {
      const known = options.members.some(
        (m) => m.name.toLowerCase() === handle.toLowerCase(),
      );
      if (!known) return match;
      return `${prefix}[@${handle}](/${options.projectSlug}/settings/members)`;
    },
  );
};
