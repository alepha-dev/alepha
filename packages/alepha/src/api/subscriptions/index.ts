import { $module } from "alepha";
import { AdminSubscriptionController } from "./controllers/AdminSubscriptionController.ts";
import { SubscriptionController } from "./controllers/SubscriptionController.ts";
import { SubscriptionJobs } from "./jobs/SubscriptionJobs.ts";
import { SubscriptionNotifications } from "./notifications/SubscriptionNotifications.ts";
import { BillingService } from "./services/BillingService.ts";
import { SubscriptionConfig } from "./services/SubscriptionConfig.ts";
import { SubscriptionService } from "./services/SubscriptionService.ts";
import { UsageService } from "./services/UsageService.ts";

// Controllers
export * from "./controllers/AdminSubscriptionController.ts";
export * from "./controllers/SubscriptionController.ts";
// Entities
export * from "./entities/subscriptionEvents.ts";
export * from "./entities/subscriptions.ts";
// Jobs
export * from "./jobs/SubscriptionJobs.ts";
// Middleware
export * from "./middleware/$requireLimit.ts";
export * from "./middleware/$requirePlan.ts";
// Notifications
export * from "./notifications/SubscriptionNotifications.ts";
// Schemas
export * from "./schemas/cancelSubscriptionSchema.ts";
export * from "./schemas/changePlanSchema.ts";
export * from "./schemas/createSubscriptionSchema.ts";
export * from "./schemas/entitlementsSchema.ts";
export * from "./schemas/mrrSchema.ts";
export * from "./schemas/planDefinitionSchema.ts";
export * from "./schemas/planResourceSchema.ts";
export * from "./schemas/subscriptionEventResourceSchema.ts";
export * from "./schemas/subscriptionQuerySchema.ts";
export * from "./schemas/subscriptionResourceSchema.ts";
export * from "./schemas/subscriptionSettingsSchema.ts";
export * from "./schemas/subscriptionStatsSchema.ts";
// Services
export * from "./services/BillingService.ts";
export * from "./services/SubscriptionConfig.ts";
export * from "./services/SubscriptionService.ts";
export * from "./services/UsageService.ts";

declare module "alepha" {
  interface Hooks {
    "subscription:created": {
      subscriptionId: string;
      organizationId: string;
      planId: string;
      trial: boolean;
    };
    "subscription:activated": {
      subscriptionId: string;
      organizationId: string;
      planId: string;
    };
    "subscription:renewed": {
      subscriptionId: string;
      organizationId: string;
      planId: string;
      amount: number;
      currency: string;
    };
    "subscription:cancelled": {
      subscriptionId: string;
      organizationId: string;
      planId: string;
      reason?: string;
      immediate: boolean;
    };
    "subscription:expired": {
      subscriptionId: string;
      organizationId: string;
      planId: string;
    };
    "subscription:resumed": {
      subscriptionId: string;
      organizationId: string;
      planId: string;
    };
    "subscription:plan_changed": {
      subscriptionId: string;
      organizationId: string;
      oldPlanId: string;
      newPlanId: string;
      immediate: boolean;
    };
    "subscription:payment_failed": {
      subscriptionId: string;
      organizationId: string;
      planId: string;
      attempt: number;
    };
    "subscription:suspended": {
      subscriptionId: string;
      organizationId: string;
      planId: string;
    };
    "subscription:reactivated": {
      subscriptionId: string;
      organizationId: string;
      planId: string;
    };
    "subscription:trial_ending": {
      subscriptionId: string;
      organizationId: string;
      planId: string;
      endsAt: string;
    };
  }
}

/**
 * Subscription management module — plan-based access control, billing integration,
 * usage limits, and lifecycle events (trial, renewal, cancellation, suspension).
 *
 * Depends on `AlephaPayments` for payment processing — register it in your app
 * alongside this module. Use `SubscriptionConfig` to declare your plans and limits.
 *
 * @module alepha.api.subscriptions
 */
export const AlephaApiSubscriptions = $module({
  name: "alepha.api.subscriptions",
  services: [
    SubscriptionConfig,
    SubscriptionService,
    BillingService,
    UsageService,
    SubscriptionJobs,
    SubscriptionNotifications,
    SubscriptionController,
    AdminSubscriptionController,
  ],
  register: (alepha) => {
    alepha
      .with(SubscriptionConfig)
      .with(SubscriptionService)
      .with(BillingService)
      .with(UsageService)
      .with(SubscriptionJobs)
      .with(SubscriptionNotifications)
      .with(SubscriptionController)
      .with(AdminSubscriptionController);
  },
});
