import { type Static, t } from "alepha";

export const mrrSchema = t.object({
  total: t.integer(),
  byPlan: t.record(t.text(), t.integer()),
  growth: t.integer(),
  newMrr: t.integer(),
  expansionMrr: t.integer(),
  contractionMrr: t.integer(),
  churnMrr: t.integer(),
});

export type MrrData = Static<typeof mrrSchema>;
