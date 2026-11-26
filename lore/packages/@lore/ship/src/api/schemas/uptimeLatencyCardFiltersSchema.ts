import { type Infer, z } from "alepha";

/**
 * The `uptimeLatency` card's filter (#Q4426): which monitor, by name; empty
 * is the project's first http monitor.
 */
export const uptimeLatencyCardFiltersSchema = z.object({
  monitor: z.string().max(200).default(""),
});

export type UptimeLatencyCardFilters = Infer<
  typeof uptimeLatencyCardFiltersSchema
>;
