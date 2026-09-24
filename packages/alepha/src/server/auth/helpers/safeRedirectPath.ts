/**
 * Returns a safe in-app redirect target: a single absolute path on the current
 * origin. Rejects protocol-relative (`//host`), absolute URLs, and backslash
 * tricks so a crafted `redirect` query can't become a post-auth open redirect.
 *
 * Control characters are refused outright: a browser strips a tab, CR or LF
 * from a `Location` before resolving it, so `/\t/evil.example` would land on
 * `//evil.example`. The value is then resolved against a placeholder origin,
 * and anything that leaves that origin, or whose path starts with `//`, falls
 * back: the check is the URL parser's reading, not a list of known tricks.
 */
export function safeRedirectPath(
  redirect: string | undefined,
  fallback = "/",
): string {
  if (
    typeof redirect !== "string" ||
    !redirect.startsWith("/") ||
    redirect.startsWith("//") ||
    redirect.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(redirect)
  ) {
    return fallback;
  }

  const origin = "http://redirect.invalid";
  try {
    const resolved = new URL(redirect, origin);
    if (resolved.origin !== origin || resolved.pathname.startsWith("//")) {
      return fallback;
    }
  } catch {
    return fallback;
  }

  return redirect;
}
