import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";
import { cancelSubscriptionSchema } from "../schemas/cancelSubscriptionSchema.ts";
import { changePlanSchema } from "../schemas/changePlanSchema.ts";
import { mrrSchema } from "../schemas/mrrSchema.ts";
import { subscriptionQuerySchema } from "../schemas/subscriptionQuerySchema.ts";
import { subscriptionResourceSchema } from "../schemas/subscriptionResourceSchema.ts";
import { subscriptionStatsSchema } from "../schemas/subscriptionStatsSchema.ts";
import { SubscriptionConfig } from "../services/SubscriptionConfig.ts";
import { SubscriptionService } from "../services/SubscriptionService.ts";

export class AdminSubscriptionController {
  protected readonly url = "/subscriptions";
  protected readonly group = "admin:subscriptions";
  protected readonly service = $inject(SubscriptionService);
  protected readonly config = $inject(SubscriptionConfig);

  /**
   * Find subscriptions with pagination and filtering.
   */
  public readonly findSubscriptions = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:subscription:read"] })],
    description: "Find subscriptions with pagination and filtering",
    schema: {
      query: subscriptionQuerySchema,
      response: z.page(subscriptionResourceSchema),
    },
    handler: ({ query }) => this.service.findSubscriptions(query),
  });

  /**
   * Get a subscription by ID.
   */
  public readonly getSubscription = $action({
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:subscription:read"] })],
    description: "Get a subscription by ID",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: subscriptionResourceSchema,
    },
    handler: ({ params }) => this.service.getSubscription(params.id),
  });

  /**
   * Get aggregated subscription statistics.
   */
  public readonly getStats = $action({
    path: `${this.url}/stats`,
    group: this.group,
    use: [$secure({ permissions: ["admin:subscription:read"] })],
    description: "Get aggregated subscription statistics",
    schema: {
      response: subscriptionStatsSchema,
    },
    handler: () => this.service.getStats(),
  });

  /**
   * Get revenue data from recent subscription events.
   */
  public readonly getRevenue = $action({
    path: `${this.url}/revenue`,
    group: this.group,
    use: [$secure({ permissions: ["admin:subscription:read"] })],
    description: "Get revenue data from recent subscription events",
    schema: {
      query: z.object({
        days: z.integer().min(1).max(365).optional(),
      }),
      response: z.object({ total: z.integer(), count: z.integer() }),
    },
    handler: ({ query }) => this.service.getRevenue(query.days),
  });

  /**
   * Get Monthly Recurring Revenue breakdown.
   */
  public readonly getMrr = $action({
    path: `${this.url}/mrr`,
    group: this.group,
    use: [$secure({ permissions: ["admin:subscription:read"] })],
    description: "Get Monthly Recurring Revenue breakdown",
    schema: {
      response: mrrSchema,
    },
    handler: async () => {
      const activeSubs = await this.service.findSubscriptions({
        status: "active",
        size: 1000,
      });

      const plans = await this.config.getPlans();
      const byPlan: Record<string, number> = {};
      let total = 0;

      for (const sub of activeSubs.content) {
        const plan = plans.find((p) => p.id === sub.planId);
        if (!plan) continue;

        const pricing = plan.pricing.find((p) => p.interval === sub.interval);
        if (!pricing) continue;

        const monthlyAmount =
          sub.interval === "yearly"
            ? Math.round(pricing.amount / 12)
            : pricing.amount;

        byPlan[sub.planId] = (byPlan[sub.planId] ?? 0) + monthlyAmount;
        total += monthlyAmount;
      }

      return {
        total,
        byPlan,
        growth: 0,
        newMrr: 0,
        expansionMrr: 0,
        contractionMrr: 0,
        churnMrr: 0,
      };
    },
  });

  /**
   * Force a plan change for a subscription (admin action).
   */
  public readonly adminChangePlan = $action({
    method: "POST",
    path: `${this.url}/:id/change-plan`,
    group: this.group,
    use: [$secure({ permissions: ["admin:subscription:update"] })],
    description: "Force a plan change for a subscription",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: changePlanSchema,
      response: subscriptionResourceSchema,
    },
    handler: async ({ params, body }) => {
      await this.service.changePlan(params.id, body.planId, body.interval, {
        immediate: body.immediate,
      });
      return this.service.getSubscription(params.id);
    },
  });

  /**
   * Force cancel a subscription (admin action).
   */
  public readonly adminCancel = $action({
    method: "POST",
    path: `${this.url}/:id/cancel`,
    group: this.group,
    use: [$secure({ permissions: ["admin:subscription:update"] })],
    description: "Force cancel a subscription",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: cancelSubscriptionSchema,
      response: okSchema,
    },
    handler: async ({ params, body }) => {
      await this.service.cancel(params.id, {
        reason: body.reason,
        immediate: body.immediate,
      });
      return { ok: true };
    },
  });

  /**
   * Reactivate a suspended subscription (admin action).
   */
  public readonly adminReactivate = $action({
    method: "POST",
    path: `${this.url}/:id/reactivate`,
    group: this.group,
    use: [$secure({ permissions: ["admin:subscription:update"] })],
    description: "Reactivate a suspended subscription",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.service.reactivate(params.id);
      return { ok: true };
    },
  });

  /**
   * Extend the trial period for a trialing subscription (admin action).
   */
  public readonly adminExtendTrial = $action({
    method: "POST",
    path: `${this.url}/:id/extend-trial`,
    group: this.group,
    use: [$secure({ permissions: ["admin:subscription:update"] })],
    description: "Extend the trial period for a subscription",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ days: z.integer().min(1).max(365) }),
      response: okSchema,
    },
    handler: async ({ params, body }) => {
      await this.service.extendTrial(params.id, body.days);
      return { ok: true };
    },
  });
}
