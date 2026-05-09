import { type Static, t } from "alepha";

export const changePlanSchema = t.object({
  planId: t.string(),
  interval: t.optional(t.enum(["monthly", "yearly"])),
  immediate: t.optional(t.boolean()),
});

export type ChangePlan = Static<typeof changePlanSchema>;
