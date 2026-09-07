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
      /**
       * The caller's EFFECTIVE permission set in this project - application
       * permission AND rank AND capability, resolved server-side by
       * `getProjectBySlug`. Read through `canInProject` / `useRank`.
       *
       * Optional for the same reason `memberCount` is: other writers
       * (`updateProjectById`, the capability toggle) reset the atom with a
       * plain project resource. ⚠️ A writer that drops it hides every
       * rank-gated control until the next navigation, so those call sites
       * carry it forward rather than spreading a narrower shape.
       */
      permissions: z.array(z.text()).optional(),
      /**
       * Which rank produced them. For naming it, never for gating on it.
       */
      rank: z.object({ key: z.text(), name: z.text() }).optional(),
    })
    .optional(),
});
