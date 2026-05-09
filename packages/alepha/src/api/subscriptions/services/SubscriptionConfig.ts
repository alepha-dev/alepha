import { t } from "alepha";
import { $parameter } from "alepha/api/parameters";
import { BadRequestError } from "alepha/server";
import {
  type PlanDefinition,
  planDefinitionSchema,
} from "../schemas/planDefinitionSchema.ts";
import {
  type SubscriptionSettings,
  subscriptionSettingsSchema,
} from "../schemas/subscriptionSettingsSchema.ts";

export class SubscriptionConfig {
  protected readonly plans = $parameter({
    name: "subscriptions.plans",
    description: "Subscription plan definitions",
    schema: t.object({ plans: t.array(planDefinitionSchema) }),
    default: { plans: [] },
  });

  protected readonly settings = $parameter({
    name: "subscriptions.settings",
    description: "Global subscription settings",
    schema: subscriptionSettingsSchema,
    default: {
      trialDays: 14,
      gracePeriodDays: 7,
      dunningSchedule: [1, 3, 5, 7],
      cancelAtPeriodEnd: true,
      prorateOnChange: true,
    },
  });

  public async getPlans(): Promise<PlanDefinition[]> {
    return (await this.plans.get()).plans;
  }

  public async getSettings(): Promise<SubscriptionSettings> {
    return this.settings.get();
  }

  public async getPlan(planId: string): Promise<PlanDefinition> {
    const plans = await this.getPlans();
    const plan = plans.find((p) => p.id === planId);
    if (!plan) throw new BadRequestError(`Plan '${planId}' not found`);
    return plan;
  }

  public async getPlanPricing(planId: string, interval: "monthly" | "yearly") {
    const plan = await this.getPlan(planId);
    const pricing = plan.pricing.find((p) => p.interval === interval);
    if (!pricing)
      throw new BadRequestError(`No ${interval} pricing for plan '${planId}'`);
    return pricing;
  }
}
