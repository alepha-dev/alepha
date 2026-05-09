import { $hook, $inject, Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import type { SubscriptionEventEntity } from "../entities/subscriptionEvents.ts";
import { subscriptionEvents } from "../entities/subscriptionEvents.ts";
import {
  type SubscriptionEntity,
  subscriptions,
} from "../entities/subscriptions.ts";
import { SubscriptionConfig } from "./SubscriptionConfig.ts";

// -----------------------------------------------------------------------------------------------------------------

interface PaymentEvent {
  intentId: string;
  amount: number;
  currency: string;
  metadata?: unknown;
}

// -----------------------------------------------------------------------------------------------------------------

interface EventContext {
  previousStatus?: string;
  newStatus?: string;
  previousPlanId?: string;
  newPlanId?: string;
  paymentIntentId?: string;
  amount?: number;
  currency?: string;
  triggeredBy?: string;
  userId?: string;
  note?: string;
}

// -----------------------------------------------------------------------------------------------------------------

export class BillingService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly subscriptionRepo = $repository(subscriptions);
  protected readonly eventRepo = $repository(subscriptionEvents);
  protected readonly paymentService = $inject(PaymentService);
  protected readonly config = $inject(SubscriptionConfig);

  // ---------------------------------------------------------------------------------------------------------------
  // Payment hook listeners
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * React to successful payment capture.
   * Routes to the appropriate handler based on subscription status.
   */
  protected readonly onPaymentCaptured = $hook({
    on: "payments:captured",
    handler: async (event) => {
      const sub = await this.findByPaymentIntent(event.intentId);
      if (!sub) return;

      if (sub.status === "trialing") {
        await this.activate(sub, event);
      } else if (sub.status === "active") {
        await this.renew(sub, event);
      } else if (sub.status === "past_due") {
        await this.recoverFromDunning(sub, event);
      } else if (sub.status === "suspended") {
        await this.reactivateFromPayment(sub, event);
      }
    },
  });

  /**
   * React to failed payment.
   * Starts or advances the dunning flow.
   */
  protected readonly onPaymentFailed = $hook({
    on: "payments:failed",
    handler: async (event) => {
      const sub = await this.findByPaymentIntent(event.intentId);
      if (!sub) return;

      await this.handlePaymentFailure(sub, event);
    },
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Find a subscription by its last payment intent ID.
   * Returns null if no subscription matches.
   */
  protected async findByPaymentIntent(
    intentId: string,
  ): Promise<SubscriptionEntity | null> {
    const sub = await this.subscriptionRepo.findOne({
      where: { lastPaymentIntentId: { eq: intentId } },
    });
    return sub ?? null;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Lifecycle transitions
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Trial to active transition.
   * Sets the first paid billing period and records activation events.
   */
  protected async activate(
    sub: SubscriptionEntity,
    event: PaymentEvent,
  ): Promise<void> {
    const orgId = sub.organizationId as string;
    const now = this.dateTime.now();
    const nowISO = now.toISOString();
    const periodEnd = this.computeIntervalEnd(nowISO, sub.interval);

    await this.subscriptionRepo.updateById(sub.id, {
      status: "active",
      lastPaymentAt: nowISO,
      lastPaymentIntentId: event.intentId,
      currentPeriodStart: nowISO,
      currentPeriodEnd: periodEnd,
      nextBillingAt: periodEnd,
    });

    await this.recordEvent(sub.id, orgId, "trial_ended", {
      previousStatus: "trialing",
      newStatus: "active",
      paymentIntentId: event.intentId,
      amount: event.amount,
      currency: event.currency,
    });

    await this.recordEvent(sub.id, orgId, "activated", {
      previousStatus: "trialing",
      newStatus: "active",
      paymentIntentId: event.intentId,
      amount: event.amount,
      currency: event.currency,
    });

    this.log.info("Subscription activated from trial", {
      id: sub.id,
      organizationId: orgId,
      planId: sub.planId,
    });

    await this.alepha.events.emit("subscription:activated" as any, {
      subscriptionId: sub.id,
      organizationId: orgId,
      planId: sub.planId,
    });
  }

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Active to active cycle renewal.
   * Applies any pending plan change, then advances the billing period.
   */
  protected async renew(
    sub: SubscriptionEntity,
    event: PaymentEvent,
  ): Promise<void> {
    const orgId = sub.organizationId as string;
    let effectivePlanId = sub.planId;
    let effectiveInterval = sub.interval;

    if (sub.pendingPlanId) {
      effectivePlanId = sub.pendingPlanId;
      effectiveInterval = sub.pendingInterval ?? sub.interval;

      await this.subscriptionRepo.updateById(sub.id, {
        planId: effectivePlanId,
        interval: effectiveInterval,
        pendingPlanId: undefined,
        pendingInterval: undefined,
      });

      await this.recordEvent(sub.id, orgId, "plan_changed", {
        previousPlanId: sub.planId,
        newPlanId: effectivePlanId,
        note: `Plan changed on renewal from '${sub.planId}' to '${effectivePlanId}'`,
      });
    }

    const newPeriodStart = sub.currentPeriodEnd;
    const newPeriodEnd = this.computeIntervalEnd(
      newPeriodStart,
      effectiveInterval,
    );

    await this.subscriptionRepo.updateById(sub.id, {
      currentPeriodStart: newPeriodStart,
      currentPeriodEnd: newPeriodEnd,
      lastPaymentAt: this.dateTime.now().toISOString(),
      lastPaymentIntentId: event.intentId,
      nextBillingAt: newPeriodEnd,
    });

    await this.recordEvent(sub.id, orgId, "renewed", {
      paymentIntentId: event.intentId,
      amount: event.amount,
      currency: event.currency,
    });

    this.log.info("Subscription renewed", {
      id: sub.id,
      organizationId: orgId,
      planId: effectivePlanId,
      periodEnd: newPeriodEnd,
    });

    await this.alepha.events.emit("subscription:renewed" as any, {
      subscriptionId: sub.id,
      organizationId: orgId,
      planId: effectivePlanId,
    });
  }

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Recover from dunning: past_due to active.
   * Resets all dunning state and records reactivation.
   */
  protected async recoverFromDunning(
    sub: SubscriptionEntity,
    event: PaymentEvent,
  ): Promise<void> {
    const orgId = sub.organizationId as string;
    const nowISO = this.dateTime.now().toISOString();

    await this.subscriptionRepo.updateById(sub.id, {
      status: "active",
      lastPaymentAt: nowISO,
      lastPaymentIntentId: event.intentId,
      dunningStartedAt: undefined,
      dunningAttempt: 0,
      dunningNextRetryAt: undefined,
    });

    await this.recordEvent(sub.id, orgId, "reactivated", {
      previousStatus: "past_due",
      newStatus: "active",
      paymentIntentId: event.intentId,
      amount: event.amount,
      currency: event.currency,
    });

    this.log.info("Subscription recovered from dunning", {
      id: sub.id,
      organizationId: orgId,
    });

    await this.alepha.events.emit("subscription:reactivated" as any, {
      subscriptionId: sub.id,
      organizationId: orgId,
      planId: sub.planId,
    });
  }

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Reactivate from suspended state after a successful payment.
   * Resets dunning, sets a fresh billing period, and records reactivation.
   */
  protected async reactivateFromPayment(
    sub: SubscriptionEntity,
    event: PaymentEvent,
  ): Promise<void> {
    const orgId = sub.organizationId as string;
    const now = this.dateTime.now();
    const nowISO = now.toISOString();
    const periodEnd = this.computeIntervalEnd(nowISO, sub.interval);

    await this.subscriptionRepo.updateById(sub.id, {
      status: "active",
      currentPeriodStart: nowISO,
      currentPeriodEnd: periodEnd,
      nextBillingAt: periodEnd,
      lastPaymentAt: nowISO,
      lastPaymentIntentId: event.intentId,
      dunningStartedAt: undefined,
      dunningAttempt: 0,
      dunningNextRetryAt: undefined,
    });

    await this.recordEvent(sub.id, orgId, "reactivated", {
      previousStatus: "suspended",
      newStatus: "active",
      paymentIntentId: event.intentId,
      amount: event.amount,
      currency: event.currency,
    });

    this.log.info("Subscription reactivated from suspended", {
      id: sub.id,
      organizationId: orgId,
      planId: sub.planId,
    });

    await this.alepha.events.emit("subscription:reactivated" as any, {
      subscriptionId: sub.id,
      organizationId: orgId,
      planId: sub.planId,
    });
  }

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Handle a failed payment: start or advance dunning.
   * Updates dunning state and transitions to past_due if needed.
   */
  protected async handlePaymentFailure(
    sub: SubscriptionEntity,
    event: PaymentEvent,
  ): Promise<void> {
    const orgId = sub.organizationId as string;
    const now = this.dateTime.now();
    const nowISO = now.toISOString();
    const settings = await this.config.getSettings();
    const schedule = settings.dunningSchedule;

    let attempt: number;

    if (sub.dunningAttempt === 0) {
      attempt = 1;
      await this.subscriptionRepo.updateById(sub.id, {
        dunningStartedAt: nowISO,
        dunningAttempt: attempt,
      });
    } else {
      attempt = sub.dunningAttempt + 1;
      await this.subscriptionRepo.updateById(sub.id, {
        dunningAttempt: attempt,
      });
    }

    if (sub.status !== "past_due") {
      await this.subscriptionRepo.updateById(sub.id, {
        status: "past_due",
      });

      await this.recordEvent(sub.id, orgId, "past_due", {
        previousStatus: sub.status,
        newStatus: "past_due",
        paymentIntentId: event.intentId,
      });
    }

    const scheduleDays = schedule[attempt - 1];

    if (scheduleDays !== undefined) {
      const nextRetry = now.add(scheduleDays, "days").toISOString();

      await this.subscriptionRepo.updateById(sub.id, {
        dunningNextRetryAt: nextRetry,
      });
    } else {
      await this.subscriptionRepo.updateById(sub.id, {
        dunningNextRetryAt: undefined,
      });
    }

    await this.recordEvent(sub.id, orgId, "payment_failed", {
      paymentIntentId: event.intentId,
      amount: event.amount,
      currency: event.currency,
      note: `Dunning attempt ${attempt}/${schedule.length}`,
    });

    this.log.warn("Subscription payment failed", {
      id: sub.id,
      organizationId: orgId,
      attempt,
      maxAttempts: schedule.length,
    });

    await this.alepha.events.emit("subscription:payment_failed" as any, {
      subscriptionId: sub.id,
      organizationId: orgId,
      planId: sub.planId,
      attempt,
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Compute the end of a billing interval from a start date.
   */
  protected computeIntervalEnd(
    start: string,
    interval: "monthly" | "yearly",
  ): string {
    const startDate = this.dateTime.of(start);
    const unit = interval === "monthly" ? "months" : "years";
    return startDate.add(1, unit).toISOString();
  }

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
      previousPlanId: context?.previousPlanId,
      newPlanId: context?.newPlanId,
      paymentIntentId: context?.paymentIntentId,
      amount: context?.amount,
      currency: context?.currency,
      triggeredBy: context?.triggeredBy,
      userId: context?.userId,
      note: context?.note,
    });
  }
}
