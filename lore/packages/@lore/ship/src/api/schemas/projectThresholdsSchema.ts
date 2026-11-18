import { type Infer, z } from "alepha";

/**
 * A project's two alert thresholds (#Q3894), as the settings read and write
 * them. `null` clears one.
 */
export const projectThresholdsSchema = z.object({
  coverageMin: z.number().min(0).max(100).nullable().optional(),
  openErrorsMax: z.integer().min(0).max(1_000_000).nullable().optional(),
});

export type ProjectThresholdsBody = Infer<typeof projectThresholdsSchema>;
