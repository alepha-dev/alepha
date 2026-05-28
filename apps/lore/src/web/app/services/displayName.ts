/**
 * Render a human-friendly label for a user across the UI.
 *
 * Priority: `username` → email-prefix → fallback.
 *
 * `username` is the canonical handle now that the realm runs in
 * `username: "email"` mode — it's auto-derived at registration (credentials
 * AND OAuth) so every freshly-created user has one. The email-prefix path
 * only kicks in for legacy rows that pre-date the rollout and never got
 * backfilled.
 *
 * We deliberately ignore `name` / `firstName` / `lastName`: the IDP-supplied
 * full name isn't surfaced anywhere in this app's UI.
 */
export const displayName = (
  user:
    | {
        username?: string | null;
        email?: string | null;
      }
    | null
    | undefined,
  fallback = "Anonymous",
): string => {
  if (user?.username?.trim()) return user.username.trim();

  const email = user?.email?.trim();
  if (email) {
    const at = email.indexOf("@");
    return at > 0 ? email.slice(0, at) : email;
  }

  return fallback;
};
