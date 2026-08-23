/**
 * Expands the two reference shapes that belong to comments alone, into
 * markdown the shared element-link resolver already understands.
 *
 * ## Why not extend the resolver itself
 *
 * `useElementLinks` / `rewriteFolioWikiLinks` render `[[...]]` for folios,
 * quests, epics and blobs, on every element that carries markdown. Teaching
 * THAT to rewrite a bare `#1204` would turn every `#5` in every folio's prose
 * into a link — a folio is a document, and documents say "#5" meaning
 * nothing. The bare form is a convention of conversation, so it is expanded
 * here, on the way in, and handed to the same resolver as `[[quest:#1204]]`.
 * One resolver, two entry points. Nothing is forked.
 *
 * ## What is left alone
 *
 * Code spans and fenced blocks pass through untouched: a comment explaining
 * `#include` or an `@decorator` must not sprout links. So does anything
 * already inside a markdown link's target or a `[[...]]` of its own.
 */
export const expandCommentReferences = (
  body: string,
  options: CommentReferenceOptions,
): string => {
  return outsideProtected(body, (segment) =>
    expandMentions(expandQuestRefs(segment), options),
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
 * `#1204` becomes `[[quest:#1204]]`, which the shared resolver turns into a
 * real link with the quest's title.
 *
 */
const expandQuestRefs = (segment: string): string =>
  segment.replace(
    // A heading is `#` followed by a space, so a digit right after it is a
    // reference either way. The two shapes that would otherwise match —
    // `[[quest:#12]]` and `](#12)` — are held out by `outsideProtected`.
    /(^|[^\w#/])#(\d+)\b/g,
    (_match, prefix: string, id: string) => `${prefix}[[quest:#${id}]]`,
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
