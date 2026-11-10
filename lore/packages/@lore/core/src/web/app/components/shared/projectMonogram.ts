/**
 * Two letters standing for a project that has no icon (#Q3366).
 *
 * The title is split on spaces, `-`, `_`, `.` and camelCase: two or more
 * words give the first letter of the first two (`my-project` is `MP`), one
 * word gives its first two letters (`hello` is `HE`). Anything that is not a
 * letter or a digit is dropped, so an emoji or a bracket never becomes half a
 * monogram. Uppercase, and `?` when nothing is left.
 */
export const projectInitials = (title: string): string => {
  const words = title
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
    .split(/[\s\-_.]+/)
    .map((word) => Array.from(word.replace(/[^\p{L}\p{N}]/gu, "")))
    .filter((chars) => chars.length > 0);
  const [first, second] = words;
  if (!first) return "?";
  const letters = second ? [first[0], second[0]] : first.slice(0, 2);
  return letters.join("").toUpperCase();
};

/**
 * Tile colours for a monogram, one string per entry so Tailwind sees every
 * class literally. A soft tint with a strong ink, readable in light and dark.
 */
export const PROJECT_MONOGRAM_COLORS = [
  "bg-red-500/15 text-red-700 dark:text-red-300",
  "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-lime-500/15 text-lime-700 dark:text-lime-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
] as const;

/**
 * The colour of a project's monogram, picked from a hash of its slug, so two
 * projects with the same initials still look different and a project keeps
 * its colour when its title changes.
 */
export const projectMonogramColor = (seed: string): string => {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return PROJECT_MONOGRAM_COLORS[hash % PROJECT_MONOGRAM_COLORS.length];
};
