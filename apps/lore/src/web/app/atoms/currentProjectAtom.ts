import { $atom, z } from "alepha";

import { projectResourceSchema } from "@/api/schemas/projectResourceSchema.ts";

export const currentProjectAtom = $atom({
  name: "lor.current.project",
  schema: projectResourceSchema
    .extend({
      // Set by the project route loader from `getProjectBySlug`. Optional
      // because other writers (e.g. `updateProjectById`) reset the atom
      // with a plain Project — readers tolerate undefined.
      memberCount: z.integer().optional(),
    })
    .optional(),
});
