/**
 * Render a human-friendly label for a user across the UI.
 *
 * Priority: `username` → email-prefix → fallback.
 *
 * `username` is the canonical handle: the realm runs in `username: "email"`
 * mode, so registration (credentials AND OAuth) derives one. The email-prefix
 * path is live all the same: the admin `createUser` (`AdminUserController` ->
 * `UserService.createUser`) accepts a user without a username, and the
 * framework's `users.username` is optional.
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
