import { type Static, t } from "alepha";

export const subscriptionSettingsSchema = t.object({
  /**
   * Default trial days (overridden per-plan if plan.trial.days is set).
   */
  trialDays: t.integer({ default: 14, minimum: 0, maximum: 365 }),

  /**
   * Days after payment failure before suspension.
   * During grace period, subscription remains active but flagged.
   */
  gracePeriodDays: t.integer({ default: 7, minimum: 0, maximum: 30 }),

  /**
   * Days after first payment failure to retry, relative to the failure date.
   * e.g., [1, 3, 5, 7] means retry on day 1, 3, 5, 7 after failure.
   */
  dunningSchedule: t.array(t.integer({ minimum: 1 })),

  /**
   * When user cancels, wait until period end (true) or cancel immediately (false).
   */
  cancelAtPeriodEnd: t.boolean({ default: true }),

  /**
   * Prorate charges when changing plans mid-cycle.
   */
  prorateOnChange: t.boolean({ default: true }),
});

export type SubscriptionSettings = Static<typeof subscriptionSettingsSchema>;
