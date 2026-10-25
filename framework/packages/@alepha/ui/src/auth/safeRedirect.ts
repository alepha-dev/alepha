/**
 * Filter a `?redirect=` query value to a safe in-app destination:
 * - only a same-origin absolute path (a single leading `/`);
 * - never `//evil.example`, a full URL, or a backslash a browser would
 *   normalise into one (the open-redirect surface);
 * - never a control character: a browser strips a tab, CR or LF before
 *   resolving, so `/\t/evil.example` would read as `//evil.example`. The same
 *   rule as the server's `safeRedirectPath`, including the URL-parser check;
 * - never `/auth/*`, which would bounce the user back into the auth flow.
 */
export const safeRedirect = (raw: string | string[] | undefined): string => {
  if (typeof raw !== "string" || raw.length === 0) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.includes("\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "/";
  const origin = "http://redirect.invalid";
  try {
    const resolved = new URL(raw, origin);
    if (resolved.origin !== origin || resolved.pathname.startsWith("//")) {
      return "/";
    }
  } catch {
    return "/";
  }
  if (raw.startsWith("/auth/")) return "/";
  return raw;
};
