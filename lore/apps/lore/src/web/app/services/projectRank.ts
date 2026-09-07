/**
 * Reading the caller's rank, web-side.
 *
 * The server computes the **effective** set once - application permission AND
 * rank AND capability - and puts it on the project the layout's loader fetches.
 * So the only operation here is `includes`: intersecting three things in the
 * browser as well would be the same rule implemented twice, and the two would
 * eventually disagree about who may do something.
 *
 * ⚠️ Module-level functions rather than a hook, exactly like `hasCapability`
 * beside it and for the same reason: these are read by `$page` LOADERS, which
 * run in the browser and cannot inject anything. A hook would work in a
 * component and not in a loader, and the two must not disagree about which
 * pages exist. `useRank()` is a thin hook over these, for components.
 *
 * ⚠️ **Never enforcement.** The server's gate answers the real request
 * whatever this hides. What it buys is a UI that does not offer an action it
 * knows will be refused.
 */
export interface ProjectRankSource {
  permissions?: string[];
  rank?: { key: string; name: string };
}

/**
 * Does the caller hold this permission in this project?
 *
 * `undefined` project answers **false**: outside a project there is no rank,
 * and a control that gates on one has nothing to render against. That is the
 * opposite of the framework's `ScopeGrantsProvider`, which answers "no scope"
 * with `undefined` so that nothing is narrowed - the difference is deliberate,
 * because that one is filtering an app-wide registry and this one is asking a
 * question that only makes sense inside a project.
 */
export const canInProject = (
  project: ProjectRankSource | undefined,
  permission: string,
): boolean => {
  const held = project?.permissions;

  // A project loaded before this field existed, or a response that dropped it,
  // reads as `undefined`. Answering false there hides controls rather than
  // showing ones the server will refuse, which is the safe direction.
  if (!held) {
    return false;
  }

  return held.some(
    (granted) =>
      granted === "*" ||
      granted === permission ||
      (granted.endsWith("*") && permission.startsWith(granted.slice(0, -1))),
  );
};

/**
 * Every permission asked for, or nothing. For a control that needs two.
 */
export const canAllInProject = (
  project: ProjectRankSource | undefined,
  permissions: string[],
): boolean => permissions.every((it) => canInProject(project, it));
