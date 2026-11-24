import { type Infer, z } from "alepha";

import { qualityRunSchema } from "./qualityRunSchema.ts";

/**
 * Everything the Reports Quality tab needs, in one call.
 *
 * `latest` is not simply `runs[0]`: it is the newest run on ONE branch, so a
 * topic branch's numbers never displace `main`'s on the headline figures while
 * both still appear in the series.
 *
 * Both fields are optional-shaped rather than absent when a project has never
 * pushed. That empty answer is what the tab's "nothing pushed yet" panel
 * renders, and Reports has never had to express one before: every other tab is
 * derived from rows Lore owns, so it cannot be empty for want of a foreign
 * system.
 */
export const qualityOverviewSchema = z.object({
  latest: qualityRunSchema.optional(),
  runs: z.array(qualityRunSchema),
});

export type QualityOverview = Infer<typeof qualityOverviewSchema>;
