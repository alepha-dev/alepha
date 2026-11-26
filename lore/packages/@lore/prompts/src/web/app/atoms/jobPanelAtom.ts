import { $atom, z } from "alepha";

/**
 * The job watched in the side panel (#Q4515), opened from a row of the
 * header's jobs list; absent while the panel is closed.
 */
export const jobPanelAtom = $atom({
  name: "lore.prompts.jobPanel",
  schema: z.object({ jobId: z.string().optional() }),
  default: {},
});
