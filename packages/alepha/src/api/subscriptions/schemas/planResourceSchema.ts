import { type Static, t } from "alepha";

export const planResourceSchema = t.object({
  id: t.string(),
  name: t.string(),
  description: t.optional(t.string()),
  pricing: t.array(
    t.object({
      interval: t.enum(["monthly", "yearly"]),
      amount: t.integer(),
      currency: t.string(),
    }),
  ),
  features: t.array(t.string()),
  limits: t.record(t.text(), t.integer()),
  trial: t.optional(
    t.object({
      days: t.integer(),
      requirePaymentMethod: t.boolean(),
    }),
  ),
  order: t.integer(),
});

export type PlanResource = Static<typeof planResourceSchema>;
