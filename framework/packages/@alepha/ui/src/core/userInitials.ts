/**
 * What `UserAvatar` reads off a user to draw its initials and colour: a
 * subset every user shape the browser holds satisfies (`auth.user`, an
 * admin list row, an organization member).
 */
export interface UserAvatarUser {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  email?: string | null;
  picture?: string | null;
}

/**
 * The background and text classes an initials avatar may wear, each pair
 * readable in the light and the dark theme. A fixed list rather than a hue
 * computed from a hash: a computed hue gives pairs nobody can read.
 *
 * ⚠️ Literal class names, so Tailwind's source scan finds them.
 */
export const USER_AVATAR_TONES = [
  "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100",
  "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100",
  "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-100",
  "bg-orange-100 text-orange-900 dark:bg-orange-900 dark:text-orange-100",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100",
] as const;

/**
 * The tone of a user, from a hash of their id: always the same for one
 * user, and untouched by a rename.
 */
export const userAvatarTone = (id: string): string => {
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  }
  return USER_AVATAR_TONES[hash % USER_AVATAR_TONES.length];
};

/**
 * The user-perceived characters of `text` (graphemes, not UTF-16 units),
 * with any leading one that is not a letter or a digit dropped: `.john`
 * starts at `j`, and an accented letter or an emoji is never cut in half.
 */
const graphemes = (text: string | null | undefined): string[] => {
  if (!text) return [];
  const segments = Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    (segment) => segment.segment,
  );
  const first = segments.findIndex((segment) => /[\p{L}\p{N}]/u.test(segment));
  return first < 0 ? [] : segments.slice(first);
};

/**
 * Two initials for a user with no picture, uppercased in `locale`: the
 * first letters of the first and last names; one name's first two; else the
 * username's first two; else the first two of the email before its `@`.
 * Empty when there is nothing to draw from, which `UserAvatar` answers with
 * its glyph.
 */
export const userInitials = (user: UserAvatarUser, locale?: string): string => {
  const first = graphemes(user.firstName);
  const last = graphemes(user.lastName);
  let initials: string[];
  if (first.length > 0 && last.length > 0) {
    initials = [first[0], last[0]];
  } else if (first.length > 0 || last.length > 0) {
    initials = (first.length > 0 ? first : last).slice(0, 2);
  } else if (graphemes(user.username).length > 0) {
    initials = graphemes(user.username).slice(0, 2);
  } else {
    initials = graphemes(user.email?.split("@")[0]).slice(0, 2);
  }
  return initials.join("").toLocaleUpperCase(locale);
};

/**
 * The name a screen reader says for the avatar: the full name, else the
 * username, else the email.
 */
export const userDisplayName = (user: UserAvatarUser): string =>
  [user.firstName, user.lastName].filter(Boolean).join(" ") ||
  user.username ||
  user.email ||
  "";
