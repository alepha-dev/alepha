/**
 * Which instance a bare app name means: **`production` if it exists, else the
 * first env by name.**
 *
 * One function because it has two callers that cannot share a class. The
 * `/apps/:app` redirect runs in the browser, so it cannot inject
 * `AppService`; the `sigil_create` shim (#1778) runs on the server and does.
 * Restating the rule in the loader is exactly how two callers end up
 * disagreeing about which page a link opens, so both read this instead.
 *
 * ⚠️ **A project-wide preference used to sit above this rule and no longer
 * does.** `projects.defaultEnv` (#1811) was consulted first until #Q2135; it
 * was one value shared by every app of a project while the question is per
 * app, so a project set to `production` with an app whose only copy is
 * `preview` held a setting that could only ever be wrong - and it outranked
 * the single place that app could go. The column is frozen on disk and nothing
 * reads it. Do not reintroduce an argument for it here.
 *
 * ⚠️ **`production` is the first step and must stay one.** A rule that
 * answered "the first env by name" outright would silently move `/apps/club`
 * from `production` to `b14-production`.
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
