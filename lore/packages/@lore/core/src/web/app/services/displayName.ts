/**
 * The parts of a user a label is made from. Every user shape Lore holds
 * (the `users` row, a project member card, `auth.user`) satisfies it.
 */
export interface DisplayNameUser {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  email?: string | null;
}

// alepha-allow no-module-code: a plain helper module the web imports directly, not a DI service: no container builds it, so there is nothing to substitute
/**
 * How a person is named on screen, across the app and its api labels.
 *
 * Priority: first and last name → `username` → email → fallback.
 *
 * A person with a name is shown by that name alone, never with their
 * username beside it: the username is a login handle, not how a person
 * introduces themselves (#Q3791). The same rule as `userDisplayName` in
 * `@alepha/ui`, which this app cannot import from its api.
 *
 * ⚠️ Never a mention handle: a name has spaces and `@handle` does not. A
 * list matched against `@...` is built with {@link mentionHandle}.
 */
export const displayName = (
  user: DisplayNameUser | null | undefined,
  fallback = "Anonymous",
): string =>
  [user?.firstName?.trim(), user?.lastName?.trim()].filter(Boolean).join(" ") ||
  user?.username?.trim() ||
  user?.email?.trim() ||
  fallback;

// alepha-allow no-module-code: a plain helper module the web imports directly, not a DI service: no container builds it, so there is nothing to substitute
/**
 * The handle a person is mentioned by: what `@...` is compared against.
 *
 * Priority: `username` → email-prefix → fallback, deliberately ignoring the
 * first and last name, which carry spaces a handle cannot.
 *
 * `username` is the canonical handle: the realm runs in `username: "email"`
 * mode, so registration (credentials AND OAuth) derives one. The email-prefix
 * path is live all the same: the admin `createUser` (`AdminUserController` ->
 * `UserService.createUser`) accepts a user without a username, and the
 * framework's `users.username` is optional.
 */
export const mentionHandle = (
  user: DisplayNameUser | null | undefined,
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
