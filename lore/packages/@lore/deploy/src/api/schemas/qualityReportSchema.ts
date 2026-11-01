import { type Infer, z } from "alepha";

import { qualityOverviewSchema } from "./qualityOverviewSchema.ts";
import { qualityRunSchema } from "./qualityRunSchema.ts";

/**
 * Quality as a section of the Delivery tab (#Q3010): the overview, narrowed to
 * a branch and the period, with what it is compared to.
 */
export const qualityReportSchema = qualityOverviewSchema.extend({
  /**
   * Every branch that pushed a run, for the selector.
   */
  branches: z.array(z.string()),
  /**
   * The branch the figures are for.
   */
  branch: z.string().optional(),
  /**
   * The newest run before the period: what the deltas read against.
   */
  previous: qualityRunSchema.optional(),
  /**
   * The project's coverage target, in percent. Absent when none is set.
   */
  target: z.number().optional(),
  /**
   * Line coverage of the newest run of each release tag, newest first. A run
   * names a commit, and an artifact names a commit and a tag.
   */
  coverageByTag: z.array(
    z.object({
      tag: z.string(),
      day: z.string(),
      coverage: z.number(),
    }),
  ),
});

export type QualityReport = Infer<typeof qualityReportSchema>;
