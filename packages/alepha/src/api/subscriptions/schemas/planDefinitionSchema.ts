import { type Static, z } from "alepha";

export const planDefinitionSchema = z.object({
  /**
   * Unique plan identifier (e.g., "free", "starter", "pro", "enterprise").
   */
  id: z.string().min(1).max(50),

  /**
   * Display name (e.g., "Pro Plan").
   */
  name: z.string(),

  /**
   * Optional description.
   */
  description: z.string().optional(),

  /**
   * Whether this plan is available for new subscriptions.
   */
  available: z.boolean().default(true),

  /**
   * Pricing per billing interval.
   * Multiple entries for monthly/yearly.
   */
  pricing: z.array(
    z.object({
      interval: z.enum(["monthly", "yearly"]),
      amount: z.integer().min(0),
      currency: z.string().min(3).max(3),
    }),
  ),

  /**
   * Trial configuration for this plan.
   * Overrides global settings.trialDays if set.
   */
  trial: z
    .object({
      days: z.integer().min(0).max(365),
      requirePaymentMethod: z.boolean().default(false),
    })
    .optional(),

  /**
   * Feature entitlements. Boolean flags for feature access.
   * Checked via SubscriptionService.can("feature-name").
   */
  features: z.array(z.string()),

  /**
   * Usage limits. Numeric caps on resources.
   * Checked via SubscriptionService.limit("resource-name").
   * -1 = unlimited.
   */
  limits: z.record(z.text(), z.integer()),

  /**
   * Sort order for display (lower = first).
   */
  order: z.integer().default(0),

  /**
   * Metadata for app-specific plan data.
   */
  metadata: z.record(z.text(), z.any()).optional(),
});

export type PlanDefinition = Static<typeof planDefinitionSchema>;
