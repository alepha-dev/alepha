import { $atom, z } from "alepha";
import { projects } from "@/api/entities/projects.ts";

/**
 * Home/AppShell bootstrap data: the user's most-recent projects plus the
 * quota state needed to gate the "Create project" CTA.
 *
 * `projects` is a capped (top-N most recent), not the full list.
 * `totalCount` reflects the real number of memberships so the UI can show
 * "+N more". `canCreate` is server-derived against `maxProjects` to keep
 * client + server in agreement on the limit.
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
