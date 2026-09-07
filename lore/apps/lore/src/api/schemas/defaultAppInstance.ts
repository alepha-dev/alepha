/**
 * Which instance a bare app name means: **the project's `defaultEnv` if that
 * env exists, else `production` if it exists, else the first env by name.**
 *
 * One function because it has two callers that cannot share a class. The
 * `/apps/:app` redirect runs in the browser, so it cannot inject
 * `AppService`; the `sigil_create` shim (#1778) runs on the server and does.
 * Restating the rule in the loader is exactly how two callers end up
 * disagreeing about which page a link opens, so both read this instead.
 *
 * ⚠️ **`projects.defaultEnv` is consulted first, and it is allowed to name
 * nothing.** The column shipped with #1811, beside the `lore apps` `--env`
 * fallback that reads it, and it is deliberately not validated against the
 * project's instances: an operator may set the env they are about to create.
 * A value naming no row falls through to the fixed rule below rather than
 * resolving to nothing, so a stale setting costs a redirect its preference and
 * never costs it its answer.
 *
 * ⚠️ **`production` stays as the second step** rather than being replaced by
 * the column. Every project that predates the column has no value in it, and a
 * rule that answered "the first env by name" for those would silently move
 * `/apps/club` from `production` to `b14-production`.
 *
 * Takes a whole list rather than a query, so the caller decides how the rows
 * were fetched. `undefined` for an app with no instance at all, which is what
 * a bare name that never existed should be.
 *
 * The sort is done here rather than assumed of the caller: `listApps` already
 * orders by `(app, env)`, but a caller that filtered or paged would silently
 * get a different answer, and "the first row I happened to hold" is not the
 * rule.
 */
export const defaultAppInstance = <T extends { app: string; env: string }>(
  rows: T[],
  app: string,
  defaultEnv?: string,
): T | undefined => {
  const siblings = rows
    .filter((row) => row.app === app)
    .sort((a, b) => a.env.localeCompare(b.env));
  return (
    (defaultEnv ? siblings.find((row) => row.env === defaultEnv) : undefined) ??
    siblings.find((row) => row.env === "production") ??
    siblings[0]
  );
};
