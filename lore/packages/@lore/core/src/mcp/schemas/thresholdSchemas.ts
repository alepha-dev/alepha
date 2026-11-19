import { z } from "alepha";

import { projectParamsSchema } from "./projectParamsSchema.ts";

/**
 * `threshold_set` (#Q3914): either threshold, or both; `null` clears one.
 */
export const thresholdSetParamsSchema = projectParamsSchema.extend({
  coverage_min: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .describe(
      "Line coverage on `main`, in percent, under which `coverage.dropped` fires once; null clears it. Needs app:manage.",
    )
    .optional(),
  open_errors_max: z
    .integer()
    .min(0)
    .max(1_000_000)
    .nullable()
    .describe(
      "Open errors over which `errors.threshold_crossed` fires once, checked hourly; null clears it. Needs error:triage.",
    )
    .optional(),
});

/**
 * Both thresholds as they stand; null is no alert.
 */
export const thresholdResultSchema = z.object({
  coverageMin: z.number().nullable(),
  openErrorsMax: z.integer().nullable(),
});
