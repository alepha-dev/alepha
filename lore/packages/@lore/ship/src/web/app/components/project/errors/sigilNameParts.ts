/**
 * The app and the environment a sigil's `name` holds.
 *
 * `sigils.name` is the server-written `app/env` mirror of the instance a sigil
 * belongs to (`AppService` is its only writer), and `/` is outside
 * `APP_NAME_PATTERN`, so its one slash is the split.
 */
export const sigilNameParts = (name: string): { app: string; env: string } => {
  const slash = name.indexOf("/");
  return { app: name.slice(0, slash), env: name.slice(slash + 1) };
};
