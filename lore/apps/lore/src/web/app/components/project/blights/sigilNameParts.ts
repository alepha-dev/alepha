/**
 * The app and the environment a sigil's `name` holds, or `undefined` when it
 * holds no pair.
 *
 * `sigils.name` is the server-written `app/env` mirror of the instance a sigil
 * belongs to, and `/` is outside `APP_NAME_PATTERN`, so its one slash is the
 * split. The `undefined` is for a value this page did not produce: the list
 * reaches it over the wire, and a pre-v3 bare name was only ever rewritten by
 * a backfill.
 */
export const sigilNameParts = (
  name: string,
): { app: string; env: string } | undefined => {
  const slash = name.indexOf("/");
  if (slash < 1 || slash === name.length - 1) {
    return undefined;
  }
  return { app: name.slice(0, slash), env: name.slice(slash + 1) };
};
