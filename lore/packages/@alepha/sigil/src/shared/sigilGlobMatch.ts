/**
 * Match a URL pathname against a glob pattern used by sigil
 * `feedbackButtonExcludedPaths`.
 *
 * Glob rules:
 * - `*` matches any sequence of chars WITHIN a path segment (no `/`).
 * - `**` matches any sequence of chars across segments.
 * - Anchored at both ends (full-path match, not substring).
 * - Matched against the pathname only — no host, no query, no hash.
 *
 * Invalid patterns (regex compile failure) return `false` rather than
 * throwing — a malformed pattern shouldn't accidentally suppress the widget.
 */
export const sigilGlobMatch = (path: string, pattern: string): boolean => {
  if (!pattern) return false;
  const escaped = pattern
    .replace(/[.+^$()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "[^/]*")
    // U+0001 sentinel re-expanded to .* below.
    .replace(//g, ".*");
  try {
    return new RegExp(`^${escaped}$`).test(path);
  } catch {
    return false;
  }
};

/** Any-of helper: true if `path` matches any pattern in the list. */
export const sigilAnyGlobMatch = (
  path: string,
  patterns: readonly string[],
): boolean => patterns.some((p) => sigilGlobMatch(path, p));
