import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { PaymentService } from "alepha/api/payments";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import type { SubscriptionEventEntity } from "../entities/subscriptionEvents.ts";
import { subscriptionEvents } from "../entities/subscriptionEvents.ts";
import { subscriptions } from "../entities/subscriptions.ts";
import { SubscriptionConfig } from "../services/SubscriptionConfig.ts";

// -----------------------------------------------------------------------------------------------------------------

interface EventContext {
  previousStatus?: string;
  newStatus?: string;
  paymentIntentId?: string;
  amount?: number;
  currency?: string;
  triggeredBy?: string;
  note?: string;
}

// -----------------------------------------------------------------------------------------------------------------

export class SubscriptionJobs {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly paymentService = $inject(PaymentService);
  protected readonly config = $inject(SubscriptionConfig);
  protected readonly subscriptionRepo = $repository(subscriptions);
  protected readonly eventRepo = $repository(subscriptionEvents);

  // ---------------------------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Record a subscription event in the event log.
   */
  protected async recordEvent(
    subscriptionId: string,
    organizationId: string,
    type: SubscriptionEventEntity["type"],
    context?: EventContext,
  ): Promise<void> {
    await this.eventRepo.create({
      subscriptionId,
      organizationId,
      type,
      previousStatus: context?.previousStatus,
      newStatus: context?.newStatus,
      paymentIntentId: context?.paymentIntentId,
      amount: context?.amount,
      currency: context?.currency,
      triggeredBy: context?.triggeredBy,
      note: context?.note,
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Jobs
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Creates payment intents for subscriptions due for renewal.
   * Runs hourly.
   */
  public readonly billingCycle = $job({
    cron: "0 * * * *",
    lock: true,
    timeout: [10, "minute"],
    handler: async ({ now }) => {
      const nowISO = now.toISOString();

      const due = await this.subscriptionRepo.findMany({
        where: {
          nextBillingAt: { lte: nowISO },
          status: { inArray: ["active", "trialing"] },
        },
      });

      this.log.info(`Billing cycle: processing ${due.length} subscription(s)`);

      for (const sub of due) {
        try {
          const pricing = await this.config.getPlanPricing(
            sub.planId,
            sub.interval,
          );

          const intent = await this.paymentService.createIntent(
            pricing.amount,
            pricing.currency,
            { subscriptionId: sub.id },
          );

          await this.subscriptionRepo.updateById(sub.id, {
            lastPaymentIntentId: intent.id,
          });

          this.log.debug("Created payment intent for subscription", {
            subscriptionId: sub.id,
            intentId: intent.id,
          });
        } catch (err) {
          this.log.error("Failed to create payment intent for subscription", {
            subscriptionId: sub.id,
            error: err,
          });
        }
      }
    },
  });

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Retries failed payments on the dunning schedule.
   * Runs hourly.
   */
  public readonly dunningRetry = $job({
    cron: "0 * * * *",
    lock: true,
    timeout: [10, "minute"],
    handler: async ({ now }) => {
      const nowISO = now.toISOString();

      const pastDue = await this.subscriptionRepo.findMany({
        where: {
          dunningNextRetryAt: { lte: nowISO },
          status: { eq: "past_due" },
        },
      });

      this.log.info(
        `Dunning retry: processing ${pastDue.length} subscription(s)`,
      );

      const settings = await this.config.getSettings();

      for (const sub of pastDue) {
        try {
          const pricing = await this.config.getPlanPricing(
            sub.planId,
            sub.interval,
          );

          const intent = await this.paymentService.createIntent(
            pricing.amount,
            pricing.currency,
            { subscriptionId: sub.id },
          );

          const newAttempt = sub.dunningAttempt + 1;
          const scheduleDays = settings.dunningSchedule[newAttempt - 1];
          const nextRetry =
            scheduleDays !== undefined
              ? now.add(scheduleDays, "days").toISOString()
              : undefined;

          await this.subscriptionRepo.updateById(sub.id, {
            lastPaymentIntentId: intent.id,
            dunningAttempt: newAttempt,
            dunningNextRetryAt: nextRetry,
          });

          await this.recordEvent(
            sub.id,
            sub.organizationId as string,
            "payment_retried",
            {
              paymentIntentId: intent.id,
              note: `Dunning retry attempt ${newAttempt}`,
            },
          );

          this.log.debug("Dunning retry payment intent created", {
            subscriptionId: sub.id,
            attempt: newAttempt,
          });
        } catch (err) {
          this.log.error("Failed to create dunning retry intent", {
            subscriptionId: sub.id,
            error: err,
          });
        }
      }
    },
  });

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Handles trial expirations.
   * Runs hourly.
   */
  public readonly trialExpiry = $job({
    cron: "0 * * * *",
    lock: true,
    handler: async ({ now }) => {
      const nowISO = now.toISOString();

      const expired = await this.subscriptionRepo.findMany({
        where: {
          trialEnd: { lte: nowISO },
          status: { eq: "trialing" },
        },
      });

      this.log.info(
        `Trial expiry: processing ${expired.length} subscription(s)`,
      );

      for (const sub of expired) {
        try {
          const pricing = await this.config.getPlanPricing(
            sub.planId,
            sub.interval,
          );

          const intent = await this.paymentService.createIntent(
            pricing.amount,
            pricing.currency,
            { subscriptionId: sub.id },
          );

          await this.subscriptionRepo.updateById(sub.id, {
            lastPaymentIntentId: intent.id,
          });

          this.log.debug("Created payment intent for trial expiry", {
            subscriptionId: sub.id,
            intentId: intent.id,
          });
        } catch (err) {
          this.log.error("Failed to process trial expiry", {
            subscriptionId: sub.id,
            error: err,
          });
        }
      }
    },
  });

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Expires cancelled subscriptions that reached period end.
   * Runs hourly.
   */
  public readonly expirationSweep = $job({
    cron: "0 * * * *",
    lock: true,
    handler: async ({ now }) => {
      const nowISO = now.toISOString();

      const toExpire = await this.subscriptionRepo.findMany({
        where: {
          currentPeriodEnd: { lte: nowISO },
          status: { eq: "cancelled" },
          cancelAtPeriodEnd: { eq: true },
        },
      });

      this.log.info(
        `Expiration sweep: expiring ${toExpire.length} subscription(s)`,
      );

      for (const sub of toExpire) {
        try {
          await this.subscriptionRepo.updateById(sub.id, {
            status: "expired",
          });

          await this.recordEvent(
            sub.id,
            sub.organizationId as string,
            "expired",
            {
              previousStatus: "cancelled",
              newStatus: "expired",
            },
          );

          this.log.debug("Subscription expired", { subscriptionId: sub.id });
        } catch (err) {
          this.log.error("Failed to expire subscription", {
            subscriptionId: sub.id,
            error: err,
          });
        }
      }
    },
  });

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Suspends past_due subscriptions where grace period has elapsed.
   * Runs daily at 2 AM.
   */
  public readonly gracePeriodSweep = $job({
    cron: "0 2 * * *",
    lock: true,
    handler: async ({ now }) => {
      const settings = await this.config.getSettings();
      const gracePeriodDays = settings.gracePeriodDays;

      const pastDueSubs = await this.subscriptionRepo.findMany({
        where: {
          status: { eq: "past_due" },
        },
      });

      const toSuspend = pastDueSubs.filter((sub) => {
        if (!sub.dunningStartedAt) return false;
        const graceEnd = this.dateTime
          .of(sub.dunningStartedAt)
          .add(gracePeriodDays, "days");
        return !now.isBefore(graceEnd.toISOString());
      });

      this.log.info(
        `Grace period sweep: suspending ${toSuspend.length} subscription(s)`,
      );

      for (const sub of toSuspend) {
        try {
          await this.subscriptionRepo.updateById(sub.id, {
            status: "suspended",
          });

          await this.recordEvent(
            sub.id,
            sub.organizationId as string,
            "suspended",
            {
              previousStatus: "past_due",
              newStatus: "suspended",
            },
          );

          this.log.debug("Subscription suspended after grace period", {
            subscriptionId: sub.id,
          });
        } catch (err) {
          this.log.error("Failed to suspend subscription", {
            subscriptionId: sub.id,
            error: err,
          });
        }
      }
    },
  });

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Purges old subscription events older than 365 days.
   * Runs daily at 3 AM.
   */
  public readonly purgeEvents = $job({
    cron: "0 3 * * *",
    lock: true,
    handler: async ({ now }) => {
      const cutoff = now.subtract(365, "days").toISOString();

      const old = await this.eventRepo.findMany({
        where: {
          createdAt: { lt: cutoff },
        },
      });

      this.log.info(`Purge events: removing ${old.length} old event(s)`);

      for (const event of old) {
        await this.eventRepo.deleteById(event.id);
      }
    },
  });
}
