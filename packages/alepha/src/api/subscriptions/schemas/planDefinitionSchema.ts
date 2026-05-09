import { type Static, t } from "alepha";

export const planDefinitionSchema = t.object({
  /**
   * Unique plan identifier (e.g., "free", "starter", "pro", "enterprise").
   */
  id: t.string({ minLength: 1, maxLength: 50 }),

  /**
   * Display name (e.g., "Pro Plan").
   */
  name: t.string(),

  /**
   * Optional description.
   */
  description: t.optional(t.string()),

  /**
   * Whether this plan is available for new subscriptions.
   */
  available: t.boolean({ default: true }),

  /**
   * Pricing per billing interval.
   * Multiple entries for monthly/yearly.
   */
  pricing: t.array(
    t.object({
      interval: t.enum(["monthly", "yearly"]),
      amount: t.integer({ minimum: 0 }),
      currency: t.string({ minLength: 3, maxLength: 3 }),
    }),
  ),

  /**
   * Trial configuration for this plan.
   * Overrides global settings.trialDays if set.
   */
  trial: t.optional(
    t.object({
      days: t.integer({ minimum: 0, maximum: 365 }),
      requirePaymentMethod: t.boolean({ default: false }),
    }),
  ),

  /**
   * Feature entitlements. Boolean flags for feature access.
   * Checked via SubscriptionService.can("feature-name").
   */
  features: t.array(t.string()),

  /**
   * Usage limits. Numeric caps on resources.
   * Checked via SubscriptionService.limit("resource-name").
   * -1 = unlimited.
   */
  limits: t.record(t.text(), t.integer()),

  /**
   * Sort order for display (lower = first).
   */
  order: t.integer({ default: 0 }),

  /**
   * Metadata for app-specific plan data.
   */
  metadata: t.optional(t.record(t.text(), t.any())),
});

export type PlanDefinition = Static<typeof planDefinitionSchema>;
