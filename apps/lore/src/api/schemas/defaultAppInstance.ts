/**
 * Which instance a bare app name means: **`production` if that env exists,
 * else the first env by name.**
 *
 * One function because it has two callers that cannot share a class. The
 * `/apps/:app` redirect runs in the browser, so it cannot inject
 * `AppService`; the `sigil_create` shim (#1778) runs on the server and does.
 * Restating the rule in the loader is exactly how two callers end up
 * disagreeing about which page a link opens, so both read this instead.
 *
 * ⚠️ **No `projects.defaultEnv` behind it, deliberately** (#1767). v3 has no
 * consumer that needs the answer persisted, and a column on the cascade parent
 * with no settings page to set it is folio #1172's failure. The column ships
 * with epic #1's #1811, beside the `--env` fallback that reads it; when it
 * does, this function is where it plugs in.
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
): T | undefined => {
  const siblings = rows
    .filter((row) => row.app === app)
    .sort((a, b) => a.env.localeCompare(b.env));
  return siblings.find((row) => row.env === "production") ?? siblings[0];
};
