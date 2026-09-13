/**
 * Filter a `?redirect=` query value to a safe in-app destination:
 * - only a same-origin absolute path (a single leading `/`);
 * - never `//evil.example`, a full URL, or a backslash a browser would
 *   normalise into one (the open-redirect surface);
 * - never `/auth/*`, which would bounce the user back into the auth flow.
 */
export const safeRedirect = (raw: string | string[] | undefined): string => {
  if (typeof raw !== "string" || raw.length === 0) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.includes("\\")) return "/";
  if (raw.startsWith("/auth/")) return "/";
  return raw;
};
