import { type Static, z } from "alepha";

export const subscriptionSettingsSchema = z.object({
  /**
   * Default trial days (overridden per-plan if plan.trial.days is set).
   */
  trialDays: z.integer().min(0).max(365).default(14),

  /**
   * Days after payment failure before suspension.
   * During grace period, subscription remains active but flagged.
   */
  gracePeriodDays: z.integer().min(0).max(30).default(7),

  /**
   * Days after first payment failure to retry, relative to the failure date.
   * e.g., [1, 3, 5, 7] means retry on day 1, 3, 5, 7 after failure.
   */
  dunningSchedule: z.array(z.integer().min(1)),

  /**
   * When user cancels, wait until period end (true) or cancel immediately (false).
   */
  cancelAtPeriodEnd: z.boolean().default(true),

  /**
   * Prorate charges when changing plans mid-cycle.
   */
  prorateOnChange: z.boolean().default(true),
});

export type SubscriptionSettings = Static<typeof subscriptionSettingsSchema>;
