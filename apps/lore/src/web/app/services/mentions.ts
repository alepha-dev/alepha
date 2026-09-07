/**
 * What counts as a mention, defined once for both sides of the feature.
 *
 * ⚠️ **This module has no imports, and must keep none.** The api tree
 * compiles it, and a workspace that compiles a Lore api file from outside
 * this app (the sigil package's typecheck does) has no `@/` alias to
 * resolve. `typedReference.ts` next door carries the same constraint and the
 * same comment; nine api files already import that one relatively.
 *
 * ## Why one definition rather than two
 *
 * The renderer decides which `@name` becomes a link, and the api decides
 * which `@name` pings somebody. A second regex on the server is how those
 * two start disagreeing: a handle that links but pings nobody, or a ping
 * with no link in the comment it came from. Neither is visible in review and
 * neither shows up in a test that only exercises one side.
 *
 * ## The handle is a DISPLAY NAME
 *
 * Both sides must build their member list with `displayName()`, which is
 * `username`, then the email prefix, then a fallback, deliberately ignoring
 * `name` / `firstName` / `lastName`. A server that assembles its roster any
 * other way disagrees about what `@nfo` even is.
 */

/**
 * A fresh matcher for `@handle`.
 *
 * A function rather than a constant because the pattern is global and a
 * shared `/g` RegExp carries `lastIndex` between calls, so two callers
 * silently skip each other's matches.
 *
 * `(^|[^\w@/])` is what keeps `me@example.com` from mentioning `@example`:
 * the character before the `@` must not be word-ish, an `@`, or a slash.
 */
export const mentionPattern = (): RegExp => /(^|[^\w@/])@([\w.-]+)/g;

/**
 * The member a handle names, or undefined when it names nobody.
 *
 * Case-insensitive, and an unmatched handle is left alone on purpose: it is
 * a typo or an email address, and neither should render as a live link or
 * reach anybody's inbox.
 */
export const resolveMention = <T extends { name: string }>(
  handle: string,
  members: T[],
): T | undefined =>
  members.find((m) => m.name.toLowerCase() === handle.toLowerCase());

/**
 * Every member mentioned in one segment of text, each at most once.
 *
 * Generic in the member, and it hands back the caller's own objects rather
 * than names: the renderer passes `{ name }` and gets `{ name }`, while the
 * api passes `{ name, userId, email }` and gets those. Returning names would
 * force the api to look each member up again by name, which is a second
 * comparison and therefore a second definition of what a mention is.
 *
 * ⚠️ Pass a segment that has already been through `outsideProtected`. This
 * runs on whatever it is given, so a caller handing it a raw body pings
 * somebody for an `@decorator` inside a fenced block.
 */
export const matchMentions = <T extends { name: string }>(
  segment: string,
  members: T[],
): T[] => {
  if (members.length === 0) return [];

  const found: T[] = [];
  for (const match of segment.matchAll(mentionPattern())) {
    const member = resolveMention(match[2] ?? "", members);
    if (member && !found.includes(member)) {
      found.push(member);
    }
  }
  return found;
};
