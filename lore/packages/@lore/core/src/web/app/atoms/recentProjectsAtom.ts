import { $atom, z } from "alepha";

/**
 * The ids of the projects this browser opened last, most recent first, at
 * most ten (#Q3366). The project rail orders its icons by it.
 *
 * ⚠️ **What the viewer opened, not what changed.** The switcher orders by
 * `updatedAt`, which moves whenever anyone (or any agent) touches a project:
 * a rail ordered that way would reorder under the cursor all day.
 *
 * A cookie rather than a column, deliberately: the server reads it while
 * rendering, so the first paint already has the right order, and it needs no
 * write per page view nor a migration. The price is that it is per browser,
 * not per account. It holds no trust: a forged value only reorders the
 * forger's own rail, and every id is matched against the membership list
 * before anything is drawn.
 */
export const recentProjectsAtom = $atom({
  name: "lor.user.recentProjects",
  schema: z.array(z.integer()),
  default: [],
  persist: "cookie",
});
