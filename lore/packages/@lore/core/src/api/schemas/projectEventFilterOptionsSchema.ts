import { type Infer, z } from "alepha";

/**
 * What a subscription's filter may name in a project (#Q3892): its hosts,
 * apps or monitors, picked and never typed.
 */
export const projectEventFilterOptionsSchema = z.object({
  items: z.array(z.object({ value: z.string(), label: z.string() })),
});

export type ProjectEventFilterOptions = Infer<
  typeof projectEventFilterOptionsSchema
>;
