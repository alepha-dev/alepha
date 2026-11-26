import { type Infer, z } from "alepha";

/**
 * Filter vocabulary of the `webVitals` metric (#Q4521): the board's own
 * period, as the visitors tile has.
 */
export const webVitalsFiltersSchema = z.object({
  period: z.enum(["window"]).meta({ mode: "text" }).default("window"),
});

export type WebVitalsFilters = Infer<typeof webVitalsFiltersSchema>;
