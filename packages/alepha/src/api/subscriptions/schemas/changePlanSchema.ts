import { type Static, z } from "alepha";

export const changePlanSchema = z.object({
  planId: z.string(),
  interval: z.enum(["monthly", "yearly"]).optional(),
  immediate: z.boolean().optional(),
});

export type ChangePlan = Static<typeof changePlanSchema>;
