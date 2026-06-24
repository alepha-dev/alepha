import { type Static, z } from "alepha";

export const mrrSchema = z.object({
  total: z.integer(),
  byPlan: z.record(z.text(), z.integer()),
  growth: z.integer(),
  newMrr: z.integer(),
  expansionMrr: z.integer(),
  contractionMrr: z.integer(),
  churnMrr: z.integer(),
});

export type MrrData = Static<typeof mrrSchema>;
