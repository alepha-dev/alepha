import { type Static, z } from "alepha";

export const planResourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  pricing: z.array(
    z.object({
      interval: z.enum(["monthly", "yearly"]),
      amount: z.integer(),
      currency: z.string(),
    }),
  ),
  features: z.array(z.string()),
  limits: z.record(z.text(), z.integer()),
  trial: z
    .object({
      days: z.integer(),
      requirePaymentMethod: z.boolean(),
    })
    .optional(),
  order: z.integer(),
});

export type PlanResource = Static<typeof planResourceSchema>;
