import { $atom, z } from "alepha";

import { releaseResourceSchema } from "@/api/schemas/releaseResourceSchema.ts";

export const currentReleasesAtom = $atom({
  name: "lor.current.releases",
  // Carries the progress rollup, which is what the list rows draw. It used
  // to carry a `questCount` derived from the milestone's time window; that
  // window is gone, and the rollup is computed from the release's contents.
  schema: z.array(releaseResourceSchema).optional(),
});
