import { $atom, z } from "alepha";
import { projects } from "@/api/entities/projects.ts";

/**
 * Home/AppShell bootstrap data: every project the user is a member of, plus
 * the quota state needed to gate the "Create project" CTA.
 *
 * `projects` is the COMPLETE membership list, ordered most-recently-updated
 * first. `getHomeOverview` applies no cap — the per-user ownership limit keeps
 * it bounded — and `totalCount` is that array's own length, so the two can
 * never disagree.
 *
 * This docstring used to describe `projects` as a top-N sample with
 * `totalCount` as the real figure behind a "+N more" tail. That stopped being
 * true and the comment did not follow, which is worth naming because a reader
 * who trusts it reaches the wrong conclusion: `Spotlight`'s project switcher
 * filters this array client-side and calls itself "Projects" precisely because
 * the list is complete. If a cap is ever reintroduced, that copy is a promise
 * that breaks with it.
 *
 * `canCreate` is server-derived against `maxProjects` to keep client + server
 * in agreement on the limit.
 */
export const userProjectsAtom = $atom({
  name: "lor.user.projects",
  schema: z
    .object({
      projects: z.array(projects.schema),
      totalCount: z.integer(),
      ownedCount: z.integer(),
      maxProjects: z.integer(),
      canCreate: z.boolean(),
    })
    .optional(),
});
