import { type Static, z } from "alepha";

export const entitlementsSchema = z.object({
  planId: z.string(),
  planName: z.string(),
  status: z.enum([
    "trialing",
    "active",
    "past_due",
    "suspended",
    "cancelled",
    "expired",
  ]),
  features: z.array(z.string()),
  limits: z.record(z.text(), z.integer()),
  trialEndsAt: z.datetime().optional(),
  periodEndsAt: z.datetime(),
  cancelledAt: z.datetime().optional(),
});

export type Entitlements = Static<typeof entitlementsSchema>;
