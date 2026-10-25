import { type Infer, z } from "alepha";

/**
 * Filter vocabulary of the `openBlights` metric.
 *
 * `open` is the default and the useful one: a blight's `status` is `open`,
 * `resolved`, or `quest:<id>` once forwarded, and only the first is still
 * asking for attention. `all` is offered so the card can also be read as
 * "how much has this app ever produced", which is a different question and
 * a legitimate one.
 */
export const openBlightsFiltersSchema = z.object({
  status: z.enum(["open", "all"]).meta({ mode: "text" }).default("open"),
});

export type OpenBlightsFilters = Infer<typeof openBlightsFiltersSchema>;
