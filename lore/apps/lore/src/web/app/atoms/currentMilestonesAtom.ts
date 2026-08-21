import { $atom, z } from "alepha";

import { milestones } from "@/api/entities/milestones.ts";

export const currentMilestonesAtom = $atom({
  name: "lor.current.milestones",
  schema: z
    .array(
      milestones.schema.extend({
        questCount: z.integer(),
      }),
    )
    .optional(),
});
