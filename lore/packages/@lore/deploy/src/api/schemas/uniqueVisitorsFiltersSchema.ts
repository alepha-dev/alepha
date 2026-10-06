import { type Infer, z } from "alepha";

/**
 * Filter vocabulary of the `uniqueVisitors` metric.
 *
 * One value for now, and that is deliberate: the tile means **yesterday
 * against the day before**, both complete UTC days, so the delta is honest.
 * A period picker is a later card, not this one — but the vocabulary is
 * already a field rather than a hardcoded constant, so adding `last7Days`
 * is a value here and a branch in the resolver, not a schema change.
 */
export const uniqueVisitorsFiltersSchema = z.object({
  period: z.enum(["yesterday"]).meta({ mode: "text" }).default("yesterday"),
});

export type UniqueVisitorsFilters = Infer<typeof uniqueVisitorsFiltersSchema>;
