/**
 * Returns a safe in-app redirect target: a single absolute path on the current
 * origin. Rejects protocol-relative (`//host`), absolute URLs, and backslash
 * tricks so a crafted `redirect` query can't become a post-auth open redirect.
 */
export function safeRedirectPath(
  redirect: string | undefined,
  fallback = "/",
): string {
  if (
    typeof redirect === "string" &&
    redirect.startsWith("/") &&
    !redirect.startsWith("//") &&
    !redirect.includes("\\")
  ) {
    return redirect;
  }
  return fallback;
}
