import { $atom, z } from "alepha";

import { releases } from "@/api/entities/releases.ts";

export const currentReleasesAtom = $atom({
  name: "lor.current.releases",
  // The list used to carry a `questCount` derived from the milestone's time
  // window. That window is gone; the real progress rollup arrives with the
  // release contents rather than being counted per row here.
  schema: z.array(releases.schema).optional(),
});
