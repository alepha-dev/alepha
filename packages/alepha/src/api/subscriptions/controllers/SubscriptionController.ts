import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, NotFoundError, okSchema } from "alepha/server";
import { cancelSubscriptionSchema } from "../schemas/cancelSubscriptionSchema.ts";
import { changePlanSchema } from "../schemas/changePlanSchema.ts";
import { createSubscriptionSchema } from "../schemas/createSubscriptionSchema.ts";
import { entitlementsSchema } from "../schemas/entitlementsSchema.ts";
import { planResourceSchema } from "../schemas/planResourceSchema.ts";
import { subscriptionEventResourceSchema } from "../schemas/subscriptionEventResourceSchema.ts";
import { subscriptionResourceSchema } from "../schemas/subscriptionResourceSchema.ts";
import { SubscriptionConfig } from "../services/SubscriptionConfig.ts";
import { SubscriptionService } from "../services/SubscriptionService.ts";

export class SubscriptionController {
  protected readonly url = "/subscriptions";
  protected readonly group = "subscriptions";
  protected readonly service = $inject(SubscriptionService);
  protected readonly config = $inject(SubscriptionConfig);

  /**
   * List available subscription plans with pricing.
   */
  public readonly getPlans = $action({
    path: `${this.url}/plans`,
    group: this.group,
    description: "List available subscription plans",
    schema: {
      response: z.array(planResourceSchema),
    },
    handler: async () => {
      const plans = await this.config.getPlans();
      return plans
        .filter((p) => p.available)
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          pricing: p.pricing,
          features: p.features,
          limits: p.limits,
          trial: p.trial,
          order: p.order,
        }));
    },
  });

  /**
   * Get the current organization's subscription.
   */
  public readonly getMySubscription = $action({
    path: `${this.url}/mine`,
    group: this.group,
    use: [$secure()],
    description: "Get the current organization subscription",
    schema: {
      response: subscriptionResourceSchema,
    },
    handler: async ({ user }) => {
      const sub = await this.service.getByOrganization(user.organization!);
      if (!sub)
        throw new NotFoundError("No subscription found for your organization");
      return sub;
    },
  });

  /**
   * Create a new subscription for the current organization.
   */
  public readonly subscribe = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["subscription:create"] })],
    description: "Create a new subscription",
    schema: {
      body: createSubscriptionSchema,
      response: subscriptionResourceSchema,
    },
    handler: ({ body, user }) =>
      this.service.subscribe(user.organization!, body.planId, body.interval, {
        skipTrial: body.skipTrial,
        metadata: body.metadata,
      }),
  });

  /**
   * Change the plan for the current organization's subscription.
   */
  public readonly changePlan = $action({
    method: "POST",
    path: `${this.url}/mine/change-plan`,
    group: this.group,
    use: [$secure({ permissions: ["subscription:update"] })],
    description: "Upgrade or downgrade the subscription plan",
    schema: {
      body: changePlanSchema,
      response: subscriptionResourceSchema,
    },
    handler: async ({ body, user }) => {
      const sub = await this.service.getByOrganization(user.organization!);
      if (!sub)
        throw new NotFoundError("No subscription found for your organization");
      await this.service.changePlan(sub.id, body.planId, body.interval, {
        immediate: body.immediate,
      });
      return this.service.getSubscription(sub.id);
    },
  });

  /**
   * Cancel the current organization's subscription.
   */
  public readonly cancel = $action({
    method: "POST",
    path: `${this.url}/mine/cancel`,
    group: this.group,
    use: [$secure({ permissions: ["subscription:update"] })],
    description: "Cancel the current subscription",
    schema: {
      body: cancelSubscriptionSchema,
      response: okSchema,
    },
    handler: async ({ body, user }) => {
      const sub = await this.service.getByOrganization(user.organization!);
      if (!sub)
        throw new NotFoundError("No subscription found for your organization");
      await this.service.cancel(sub.id, {
        reason: body.reason,
        immediate: body.immediate,
      });
      return { ok: true };
    },
  });

  /**
   * Resume a cancelled subscription before the period ends.
   */
  public readonly resume = $action({
    method: "POST",
    path: `${this.url}/mine/resume`,
    group: this.group,
    use: [$secure({ permissions: ["subscription:update"] })],
    description: "Resume a cancelled subscription",
    schema: {
      response: okSchema,
    },
    handler: async ({ user }) => {
      const sub = await this.service.getByOrganization(user.organization!);
      if (!sub)
        throw new NotFoundError("No subscription found for your organization");
      await this.service.resume(sub.id);
      return { ok: true };
    },
  });

  /**
   * Get the billing event history for the current organization's subscription.
   */
  public readonly getSubscriptionHistory = $action({
    path: `${this.url}/mine/history`,
    group: this.group,
    use: [$secure()],
    description: "Get the subscription billing event history",
    schema: {
      response: z.array(subscriptionEventResourceSchema),
    },
    handler: async ({ user }) => {
      const sub = await this.service.getByOrganization(user.organization!);
      if (!sub)
        throw new NotFoundError("No subscription found for your organization");
      return this.service.getHistory(sub.id);
    },
  });

  /**
   * Get the feature and usage limit entitlements for the current organization.
   */
  public readonly getEntitlements = $action({
    path: `${this.url}/mine/entitlements`,
    group: this.group,
    use: [$secure()],
    description:
      "Get the feature and limit entitlements for the current organization",
    schema: {
      response: entitlementsSchema,
    },
    handler: ({ user }) => this.service.getEntitlements(user.organization!),
  });
}
