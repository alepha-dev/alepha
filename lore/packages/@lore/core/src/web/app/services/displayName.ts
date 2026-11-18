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
 * A first or last name in capitalized form: the first letter of each word
 * upper case, the rest lower case. A word starts the name or follows a
 * space, a hyphen or an apostrophe, so "LEFEVRE" is "Lefevre", "jean-pierre"
 * is "Jean-Pierre" and "o'brien" is "O'Brien". Accents follow the case
 * ("ÉLODIE" is "Élodie").
 *
 * ⚠️ **Forced on purpose, and revertable** (#Q3886). Names were shown as
 * typed, so one person read "Thibaut LEFEVRE" beside "Nicolas Foures". The
 * owner chose to make every name look alike at display time; the stored
 * value never changes. It is wrong for some names: a particle the person
 * writes lower case ("de", "van"), an inner capital ("McDonald",
 * "DiCaprio"). If those come to matter, delete this function's call in
 * {@link displayName} and names are shown as typed again.
 */
export const capitalizeName = (name: string): string =>
  name
    .toLocaleLowerCase()
    .replace(
      /(^|[\s'\u2019-])(\p{L})/gu,
      (_, before: string, letter: string) =>
        `${before}${letter.toLocaleUpperCase()}`,
    );

// alepha-allow no-module-code: a plain helper module the web imports directly, not a DI service: no container builds it, so there is nothing to substitute
/**
 * How a person is named on screen, across the app and its api labels.
 *
 * Priority: first and last name → `username` → email → fallback. The first
 * and last name are capitalized ({@link capitalizeName}); a username and an
 * email are handles, shown as they are.
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
  [user?.firstName?.trim(), user?.lastName?.trim()]
    .filter((part): part is string => !!part)
    .map(capitalizeName)
    .join(" ") ||
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
