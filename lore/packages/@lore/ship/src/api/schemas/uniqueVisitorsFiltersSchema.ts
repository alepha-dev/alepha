import { type Infer, z } from "alepha";

/**
 * Filter vocabulary of the `uniqueVisitors` metric.
 *
 * One value: `window`, the board's own period picker. The tile is the
 * average day's human visitors over that window against the window before
 * it (#Q4215). It was `yesterday` until then; a stored card still carrying
 * that value fails to parse on read and falls back to this default.
 */
export const uniqueVisitorsFiltersSchema = z.object({
  period: z.enum(["window"]).meta({ mode: "text" }).default("window"),
});

export type UniqueVisitorsFilters = Infer<typeof uniqueVisitorsFiltersSchema>;
