import { $atom, z } from "alepha";

import { releases } from "@/api/entities/releases.ts";

export const currentReleasesAtom = $atom({
  name: "lor.current.releases",
  schema: z
    .array(
      releases.schema.extend({
        questCount: z.integer(),
      }),
    )
    .optional(),
});
