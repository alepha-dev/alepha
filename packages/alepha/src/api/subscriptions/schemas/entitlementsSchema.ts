import { type Static, t } from "alepha";

export const entitlementsSchema = t.object({
  planId: t.string(),
  planName: t.string(),
  status: t.enum([
    "trialing",
    "active",
    "past_due",
    "suspended",
    "cancelled",
    "expired",
  ]),
  features: t.array(t.string()),
  limits: t.record(t.text(), t.integer()),
  trialEndsAt: t.optional(t.datetime()),
  periodEndsAt: t.datetime(),
  cancelledAt: t.optional(t.datetime()),
});

export type Entitlements = Static<typeof entitlementsSchema>;
