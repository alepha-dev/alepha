import { z } from "alepha";
import { $notification } from "alepha/api/notifications";

export class SubscriptionNotifications {
  /**
   * Sent when a trial is ending soon.
   */
  protected readonly trialEnding = $notification({
    name: "subscription-trial-ending",
    category: "subscriptions",
    schema: z.object({
      planName: z.text(),
      trialEndDate: z.text(),
      amount: z.text(),
      interval: z.text(),
    }),
    email: {
      subject: "Your trial is ending soon",
      body: (v) =>
        `Your ${v.planName} trial is ending on ${v.trialEndDate}. You'll be charged ${v.amount}/${v.interval}.`,
    },
  });

  /**
   * Sent when a payment fails. Critical notification.
   */
  protected readonly paymentFailed = $notification({
    name: "subscription-payment-failed",
    category: "subscriptions",
    critical: true,
    schema: z.object({
      planName: z.text(),
      amount: z.text(),
      retryDate: z.text().optional(),
    }),
    email: {
      subject: "Payment failed for your subscription",
      body: (v) =>
        `We couldn't charge your card for ${v.planName} (${v.amount}). ${v.retryDate ? `We'll retry on ${v.retryDate}.` : "Please update your payment method."}`,
    },
  });

  /**
   * Sent when a subscription is suspended due to failed payments. Critical notification.
   */
  protected readonly subscriptionSuspended = $notification({
    name: "subscription-suspended",
    category: "subscriptions",
    critical: true,
    schema: z.object({ planName: z.text() }),
    email: {
      subject: "Your subscription has been suspended",
      body: (v) =>
        `Your ${v.planName} subscription has been suspended due to failed payments. Update your payment method to reactivate.`,
    },
  });

  /**
   * Sent when a subscription is successfully renewed.
   */
  protected readonly subscriptionRenewed = $notification({
    name: "subscription-renewed",
    category: "subscriptions",
    schema: z.object({
      planName: z.text(),
      amount: z.text(),
      nextBillingDate: z.text(),
    }),
    email: {
      subject: "Payment received — subscription renewed",
      body: (v) =>
        `Your ${v.planName} subscription has been renewed. Amount: ${v.amount}. Next billing: ${v.nextBillingDate}.`,
    },
  });

  /**
   * Sent when a subscription plan is changed.
   */
  protected readonly planChanged = $notification({
    name: "subscription-plan-changed",
    category: "subscriptions",
    schema: z.object({
      oldPlanName: z.text(),
      newPlanName: z.text(),
      effectiveDate: z.text(),
    }),
    email: {
      subject: "Your subscription plan has been changed",
      body: (v) =>
        `Your plan has been changed from ${v.oldPlanName} to ${v.newPlanName}, effective ${v.effectiveDate}.`,
    },
  });

  /**
   * Sent when a subscription is cancelled.
   */
  protected readonly cancellationConfirmed = $notification({
    name: "subscription-cancelled",
    category: "subscriptions",
    schema: z.object({
      planName: z.text(),
      accessUntil: z.text().optional(),
    }),
    email: {
      subject: "Your subscription has been cancelled",
      body: (v) =>
        `Your ${v.planName} subscription has been cancelled.${v.accessUntil ? ` You'll have access until ${v.accessUntil}.` : ""}`,
    },
  });
}
