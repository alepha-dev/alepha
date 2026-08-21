import { type Infer, z } from "alepha";

/**
 * Filter vocabulary of the `activeQuests` metric.
 *
 * `statuses` is a list rather than a single value because the tile's whole
 * point is the sum of two of them: the mockup's chip reads `new + accepted`.
 * Shelved quests are neither, and quests inside a `planned` epic are outside
 * the human-facing backlog — neither is expressible here, and neither should
 * be: they are gates, not filters.
 */
export const activeQuestsFiltersSchema = z.object({
  statuses: z
    .array(z.enum(["new", "accepted"]).meta({ mode: "text" }))
    .min(1)
    .default(["new", "accepted"]),
});

export type ActiveQuestsFilters = Infer<typeof activeQuestsFiltersSchema>;
