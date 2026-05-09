import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, type Page } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";
import {
  type SubscriptionEventEntity,
  subscriptionEvents,
} from "../entities/subscriptionEvents.ts";
import {
  type SubscriptionEntity,
  subscriptions,
} from "../entities/subscriptions.ts";
import type { Entitlements } from "../schemas/entitlementsSchema.ts";
import type { SubscriptionQuery } from "../schemas/subscriptionQuerySchema.ts";
import type { SubscriptionStats } from "../schemas/subscriptionStatsSchema.ts";
import { SubscriptionConfig } from "./SubscriptionConfig.ts";

// -----------------------------------------------------------------------------------------------------------------

interface SubscribeOptions {
  /**
   * Override plan/global trial days.
   */
  trialDays?: number;

  /**
   * Go straight to active (requires payment).
   */
  skipTrial?: boolean;

  /**
   * Metadata to attach to the subscription.
   */
  metadata?: Record<string, unknown>;
}

// -----------------------------------------------------------------------------------------------------------------

interface CancelOptions {
  /**
   * Cancellation reason.
   */
  reason?: string;

  /**
   * Cancel immediately instead of at period end.
   */
  immediate?: boolean;

  /**
   * User who initiated the cancellation.
   */
  cancelledBy?: string;
}

// -----------------------------------------------------------------------------------------------------------------

interface ChangePlanOptions {
  /**
   * Apply now (with proration) or at period end.
   */
  immediate?: boolean;

  /**
   * Override settings.prorateOnChange.
   */
  prorate?: boolean;
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

export class SubscriptionService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly subscriptionRepo = $repository(subscriptions);
  protected readonly eventRepo = $repository(subscriptionEvents);
  protected readonly config = $inject(SubscriptionConfig);

  // ---------------------------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Find a subscription by organization ID.
   * Returns null if no subscription exists.
   */
  public async getByOrganization(
    organizationId: string,
  ): Promise<SubscriptionEntity | null> {
    const result = await this.subscriptionRepo.findOne({
      where: { organizationId: { eq: organizationId } },
    });
    return result ?? null;
  }

  /**
   * Get a subscription by ID. Throws NotFoundError if not found.
   */
  public async getSubscription(id: string): Promise<SubscriptionEntity> {
    return this.subscriptionRepo.getById(id);
  }

  /**
   * Returns true if the subscription currently grants access.
   * Accessible statuses: trialing, active, past_due (grace period),
   * or cancelled with cancelAtPeriodEnd before period end.
   */
  public isAccessible(sub: SubscriptionEntity): boolean {
    if (
      sub.status === "trialing" ||
      sub.status === "active" ||
      sub.status === "past_due"
    ) {
      return true;
    }

    if (
      sub.status === "cancelled" &&
      sub.cancelAtPeriodEnd &&
      this.dateTime.now().isBefore(sub.currentPeriodEnd)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Record a subscription event in the event log.
   */
  public async recordEvent(
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

  /**
   * Compute the end of a billing interval from a start date.
   */
  public computeIntervalEnd(
    start: string,
    interval: "monthly" | "yearly",
  ): string {
    const startDate = this.dateTime.of(start);
    const unit = interval === "monthly" ? "months" : "years";
    return startDate.add(1, unit).toISOString();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Create a new subscription for an organization.
   */
  public async subscribe(
    organizationId: string,
    planId: string,
    interval: "monthly" | "yearly",
    options?: SubscribeOptions,
  ): Promise<SubscriptionEntity> {
    const plan = await this.config.getPlan(planId);

    if (!plan.available) {
      throw new BadRequestError(
        `Plan '${planId}' is not available for new subscriptions`,
      );
    }

    await this.config.getPlanPricing(planId, interval);

    const existing = await this.subscriptionRepo.findOne({
      where: {
        organizationId: { eq: organizationId },
        status: { inArray: ["trialing", "active", "past_due"] },
      },
    });

    if (existing) {
      throw new BadRequestError(
        "Organization already has an active subscription",
      );
    }

    const settings = await this.config.getSettings();
    const trialDays =
      options?.trialDays ?? plan.trial?.days ?? settings.trialDays;
    const skipTrial = options?.skipTrial ?? false;
    const now = this.dateTime.now();
    const nowISO = now.toISOString();

    if (trialDays > 0 && !skipTrial) {
      const trialEnd = now.add(trialDays, "days").toISOString();

      const entity = await this.subscriptionRepo.create({
        organizationId,
        planId,
        interval,
        status: "trialing",
        currentPeriodStart: nowISO,
        currentPeriodEnd: trialEnd,
        trialStart: nowISO,
        trialEnd,
        nextBillingAt: trialEnd,
        cancelAtPeriodEnd: false,
        dunningAttempt: 0,
        metadata: options?.metadata as any,
      });

      await this.recordEvent(entity.id, organizationId, "created", {
        newStatus: "trialing",
      });

      await this.recordEvent(entity.id, organizationId, "trial_started", {
        newStatus: "trialing",
      });

      this.log.info("Subscription created with trial", {
        id: entity.id,
        organizationId,
        planId,
        trialDays,
      });

      await this.alepha.events.emit("subscription:created" as any, {
        subscription: entity,
      });

      return entity;
    }

    const periodEnd = this.computeIntervalEnd(nowISO, interval);

    const entity = await this.subscriptionRepo.create({
      organizationId,
      planId,
      interval,
      status: "active",
      currentPeriodStart: nowISO,
      currentPeriodEnd: periodEnd,
      nextBillingAt: periodEnd,
      cancelAtPeriodEnd: false,
      dunningAttempt: 0,
      metadata: options?.metadata as any,
    });

    await this.recordEvent(entity.id, organizationId, "created", {
      newStatus: "active",
    });

    this.log.info("Subscription created", {
      id: entity.id,
      organizationId,
      planId,
    });

    await this.alepha.events.emit("subscription:created" as any, {
      subscription: entity,
    });

    return entity;
  }

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Cancel a subscription.
   * If immediate, the subscription expires right away.
   * If at period end, the subscription remains accessible until the period ends.
   */
  public async cancel(
    subscriptionId: string,
    options?: CancelOptions,
  ): Promise<void> {
    const sub = await this.subscriptionRepo.getById(subscriptionId);
    const orgId = sub.organizationId as string;

    if (
      sub.status !== "trialing" &&
      sub.status !== "active" &&
      sub.status !== "past_due"
    ) {
      throw new BadRequestError(
        `Cannot cancel subscription with status '${sub.status}'`,
      );
    }

    const settings = await this.config.getSettings();
    const immediate = options?.immediate ?? !settings.cancelAtPeriodEnd;
    const now = this.dateTime.now();
    const nowISO = now.toISOString();
    const previousStatus = sub.status;

    if (immediate) {
      await this.subscriptionRepo.updateById(subscriptionId, {
        status: "expired",
        cancelledAt: nowISO,
        cancelReason: options?.reason,
        cancelAtPeriodEnd: false,
      });

      await this.recordEvent(subscriptionId, orgId, "cancelled", {
        previousStatus,
        newStatus: "expired",
        triggeredBy: options?.cancelledBy ? "user" : "system",
        userId: options?.cancelledBy,
        note: options?.reason,
      });

      this.log.info("Subscription cancelled immediately", {
        id: subscriptionId,
        organizationId: orgId,
      });
    } else {
      await this.subscriptionRepo.updateById(subscriptionId, {
        status: "cancelled",
        cancelledAt: nowISO,
        cancelReason: options?.reason,
        cancelAtPeriodEnd: true,
      });

      await this.recordEvent(subscriptionId, orgId, "cancelled", {
        previousStatus,
        newStatus: "cancelled",
        triggeredBy: options?.cancelledBy ? "user" : "system",
        userId: options?.cancelledBy,
        note: options?.reason,
      });

      this.log.info("Subscription cancelled at period end", {
        id: subscriptionId,
        organizationId: orgId,
        periodEnd: sub.currentPeriodEnd,
      });
    }

    await this.alepha.events.emit("subscription:cancelled" as any, {
      subscription: sub,
      immediate,
      reason: options?.reason,
    });
  }

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Resume a cancelled subscription before its period ends.
   * Only valid for subscriptions cancelled with cancelAtPeriodEnd.
   */
  public async resume(subscriptionId: string): Promise<void> {
    const sub = await this.subscriptionRepo.getById(subscriptionId);
    const orgId = sub.organizationId as string;

    if (sub.status !== "cancelled") {
      throw new BadRequestError(
        `Cannot resume subscription with status '${sub.status}', must be 'cancelled'`,
      );
    }

    if (!sub.cancelAtPeriodEnd) {
      throw new BadRequestError(
        "Cannot resume a subscription that was not cancelled at period end",
      );
    }

    if (!this.dateTime.now().isBefore(sub.currentPeriodEnd)) {
      throw new BadRequestError(
        "Cannot resume subscription, period has already ended",
      );
    }

    await this.subscriptionRepo.updateById(subscriptionId, {
      status: "active",
      cancelledAt: undefined,
      cancelReason: undefined,
      cancelAtPeriodEnd: false,
    });

    await this.recordEvent(subscriptionId, orgId, "resumed", {
      previousStatus: "cancelled",
      newStatus: "active",
    });

    this.log.info("Subscription resumed", {
      id: subscriptionId,
      organizationId: orgId,
    });

    await this.alepha.events.emit("subscription:resumed" as any, {
      subscription: sub,
    });
  }

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Change the plan of a subscription.
   * If immediate, proration is calculated and the plan changes now.
   * If at period end, the change is scheduled for the next renewal.
   * Returns the net proration amount (positive = charge, negative = credit).
   */
  public async changePlan(
    subscriptionId: string,
    newPlanId: string,
    newInterval?: "monthly" | "yearly",
    options?: ChangePlanOptions,
  ): Promise<number> {
    const sub = await this.subscriptionRepo.getById(subscriptionId);
    const orgId = sub.organizationId as string;

    if (sub.status !== "active" && sub.status !== "trialing") {
      throw new BadRequestError(
        `Cannot change plan for subscription with status '${sub.status}'`,
      );
    }

    const newPlan = await this.config.getPlan(newPlanId);

    if (!newPlan.available) {
      throw new BadRequestError(
        `Plan '${newPlanId}' is not available for new subscriptions`,
      );
    }

    const effectiveInterval = newInterval ?? sub.interval;
    await this.config.getPlanPricing(newPlanId, effectiveInterval);

    const settings = await this.config.getSettings();
    const immediate = options?.immediate ?? true;

    if (!immediate) {
      await this.subscriptionRepo.updateById(subscriptionId, {
        pendingPlanId: newPlanId,
        pendingInterval: effectiveInterval,
      });

      await this.recordEvent(subscriptionId, orgId, "plan_change_scheduled", {
        previousPlanId: sub.planId,
        newPlanId,
        note: `Scheduled change to '${newPlanId}' (${effectiveInterval}) at period end`,
      });

      this.log.info("Plan change scheduled for period end", {
        id: subscriptionId,
        organizationId: orgId,
        newPlanId,
        newInterval: effectiveInterval,
      });

      await this.alepha.events.emit("subscription:plan_changed" as any, {
        subscription: sub,
        previousPlanId: sub.planId,
        newPlanId,
        immediate: false,
      });

      return 0;
    }

    const shouldProrate = options?.prorate ?? settings.prorateOnChange;
    let netAmount = 0;

    if (shouldProrate && sub.status === "active") {
      netAmount = await this.calculateProration(
        sub,
        newPlanId,
        effectiveInterval,
      );
    }

    const previousPlanId = sub.planId;

    await this.subscriptionRepo.updateById(subscriptionId, {
      planId: newPlanId,
      interval: effectiveInterval,
      pendingPlanId: undefined,
      pendingInterval: undefined,
      metadata:
        netAmount < 0
          ? { ...sub.metadata, credit: Math.abs(netAmount) }
          : sub.metadata,
    });

    await this.recordEvent(subscriptionId, orgId, "plan_changed", {
      previousPlanId,
      newPlanId,
      amount: netAmount !== 0 ? Math.abs(netAmount) : undefined,
      note:
        netAmount > 0
          ? `Proration charge: ${netAmount}`
          : netAmount < 0
            ? `Proration credit: ${Math.abs(netAmount)}`
            : undefined,
    });

    this.log.info("Plan changed immediately", {
      id: subscriptionId,
      organizationId: orgId,
      previousPlanId,
      newPlanId,
      netAmount,
    });

    await this.alepha.events.emit("subscription:plan_changed" as any, {
      subscription: sub,
      previousPlanId,
      newPlanId,
      immediate: true,
      netAmount,
    });

    return netAmount;
  }

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Reactivate a suspended subscription (admin action).
   * Resets dunning state and starts a new billing period.
   */
  public async reactivate(subscriptionId: string): Promise<void> {
    const sub = await this.subscriptionRepo.getById(subscriptionId);
    const orgId = sub.organizationId as string;

    if (sub.status !== "suspended") {
      throw new BadRequestError(
        `Cannot reactivate subscription with status '${sub.status}', must be 'suspended'`,
      );
    }

    const now = this.dateTime.now();
    const nowISO = now.toISOString();
    const periodEnd = this.computeIntervalEnd(nowISO, sub.interval);

    await this.subscriptionRepo.updateById(subscriptionId, {
      status: "active",
      currentPeriodStart: nowISO,
      currentPeriodEnd: periodEnd,
      nextBillingAt: periodEnd,
      dunningStartedAt: undefined,
      dunningAttempt: 0,
      dunningNextRetryAt: undefined,
    });

    await this.recordEvent(subscriptionId, orgId, "reactivated", {
      previousStatus: "suspended",
      newStatus: "active",
    });

    this.log.info("Subscription reactivated", {
      id: subscriptionId,
      organizationId: orgId,
    });

    await this.alepha.events.emit("subscription:reactivated" as any, {
      subscription: sub,
    });
  }

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Extend the trial period of a trialing subscription.
   */
  public async extendTrial(
    subscriptionId: string,
    days: number,
  ): Promise<void> {
    const sub = await this.subscriptionRepo.getById(subscriptionId);

    if (sub.status !== "trialing") {
      throw new BadRequestError(
        `Cannot extend trial for subscription with status '${sub.status}', must be 'trialing'`,
      );
    }

    if (!sub.trialEnd) {
      throw new BadRequestError("Subscription has no trial end date set");
    }

    const currentTrialEnd = this.dateTime.of(sub.trialEnd);
    const newTrialEnd = currentTrialEnd.add(days, "days").toISOString();

    await this.subscriptionRepo.updateById(subscriptionId, {
      trialEnd: newTrialEnd,
      currentPeriodEnd: newTrialEnd,
      nextBillingAt: newTrialEnd,
    });

    this.log.info("Trial extended", {
      id: subscriptionId,
      organizationId: sub.organizationId as string,
      days,
      newTrialEnd,
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Entitlements
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Check if an organization has access to a specific feature.
   */
  public async can(organizationId: string, feature: string): Promise<boolean> {
    const sub = await this.getByOrganization(organizationId);
    if (!sub || !this.isAccessible(sub)) return false;
    const plan = await this.config.getPlan(sub.planId);
    return plan.features.includes(feature);
  }

  /**
   * Get the usage limit for a resource.
   * Returns -1 for unlimited, 0 for no access.
   */
  public async limit(
    organizationId: string,
    resource: string,
  ): Promise<number> {
    const sub = await this.getByOrganization(organizationId);
    if (!sub || !this.isAccessible(sub)) return 0;
    const plan = await this.config.getPlan(sub.planId);
    return plan.limits[resource] ?? 0;
  }

  /**
   * Get the full entitlements snapshot for an organization.
   */
  public async getEntitlements(organizationId: string): Promise<Entitlements> {
    const sub = await this.getByOrganization(organizationId);

    if (!sub) {
      throw new NotFoundError(
        `No subscription found for organization '${organizationId}'`,
      );
    }

    const plan = await this.config.getPlan(sub.planId);

    return {
      planId: plan.id,
      planName: plan.name,
      status: sub.status,
      features: plan.features,
      limits: plan.limits,
      trialEndsAt: sub.trialEnd,
      periodEndsAt: sub.currentPeriodEnd,
      cancelledAt: sub.cancelledAt,
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Find subscriptions with pagination and filtering.
   */
  public async findSubscriptions(
    query: SubscriptionQuery = {},
  ): Promise<Page<SubscriptionEntity>> {
    query.sort ??= "-createdAt";

    const where = this.subscriptionRepo.createQueryWhere();

    if (query.status) {
      where.status = { eq: query.status };
    }

    if (query.planId) {
      where.planId = { eq: query.planId };
    }

    if (query.organizationId) {
      where.organizationId = { eq: query.organizationId };
    }

    return this.subscriptionRepo.paginate(query, { where }, { count: true });
  }

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Get the event history for a subscription, ordered by most recent first.
   */
  public async getHistory(
    subscriptionId: string,
  ): Promise<SubscriptionEventEntity[]> {
    return this.eventRepo.findMany({
      where: { subscriptionId: { eq: subscriptionId } },
      orderBy: { column: "createdAt", direction: "desc" },
    });
  }

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Get aggregated subscription statistics.
   */
  public async getStats(): Promise<SubscriptionStats> {
    const [trialing, active, pastDue, suspended, cancelled, expired] =
      await Promise.all([
        this.subscriptionRepo.count({ status: { eq: "trialing" } }),
        this.subscriptionRepo.count({ status: { eq: "active" } }),
        this.subscriptionRepo.count({ status: { eq: "past_due" } }),
        this.subscriptionRepo.count({ status: { eq: "suspended" } }),
        this.subscriptionRepo.count({ status: { eq: "cancelled" } }),
        this.subscriptionRepo.count({ status: { eq: "expired" } }),
      ]);

    const total = trialing + active + pastDue + suspended + cancelled + expired;

    const trialEndedEvents = await this.eventRepo.count({
      type: { eq: "trial_ended" },
    });
    const activatedEvents = await this.eventRepo.count({
      type: { eq: "activated" },
    });
    const trialConversionRate =
      trialEndedEvents > 0 ? activatedEvents / trialEndedEvents : 0;

    const cancelledEvents = await this.eventRepo.count({
      type: { eq: "cancelled" },
    });
    const totalSubscribed = active + trialing + pastDue;
    const churnRate =
      totalSubscribed + cancelledEvents > 0
        ? cancelledEvents / (totalSubscribed + cancelledEvents)
        : 0;

    const plans = await this.config.getPlans();
    const byPlan: Record<
      string,
      { active: number; trialing: number; total: number }
    > = {};

    for (const plan of plans) {
      const [planActive, planTrialing] = await Promise.all([
        this.subscriptionRepo.count({
          planId: { eq: plan.id },
          status: { eq: "active" },
        }),
        this.subscriptionRepo.count({
          planId: { eq: plan.id },
          status: { eq: "trialing" },
        }),
      ]);

      byPlan[plan.id] = {
        active: planActive,
        trialing: planTrialing,
        total: planActive + planTrialing,
      };
    }

    return {
      total,
      trialing,
      active,
      pastDue,
      suspended,
      cancelled,
      expired,
      trialConversionRate,
      churnRate,
      byPlan,
    };
  }

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Get revenue data from recent subscription events.
   * Sums amounts from renewed and activated events within the specified window.
   */
  public async getRevenue(
    days = 30,
  ): Promise<{ total: number; count: number }> {
    const cutoff = this.dateTime.now().subtract(days, "days").toISOString();

    const events = await this.eventRepo.findMany({
      where: {
        type: { inArray: ["renewed", "activated"] },
        createdAt: { gt: cutoff },
      },
    });

    let total = 0;
    for (const event of events) {
      total += event.amount ?? 0;
    }

    return { total, count: events.length };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Protected helpers
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Calculate proration for a mid-cycle plan change.
   * Returns the net amount: positive = charge, negative = credit.
   */
  protected async calculateProration(
    sub: SubscriptionEntity,
    newPlanId: string,
    newInterval: "monthly" | "yearly",
  ): Promise<number> {
    const oldPricing = await this.config.getPlanPricing(
      sub.planId,
      sub.interval,
    );
    const newPricing = await this.config.getPlanPricing(newPlanId, newInterval);

    const now = this.dateTime.now();
    const periodStart = this.dateTime.of(sub.currentPeriodStart);
    const periodEnd = this.dateTime.of(sub.currentPeriodEnd);

    const daysInPeriod = periodEnd.diff(periodStart, "days");
    if (daysInPeriod <= 0) return 0;

    const daysUsed = now.diff(periodStart, "days");
    const daysRemaining = daysInPeriod - daysUsed;

    const oldDailyRate = oldPricing.amount / daysInPeriod;
    const newDailyRate = newPricing.amount / daysInPeriod;

    const credit = Math.round(daysRemaining * oldDailyRate);
    const charge = Math.round(daysRemaining * newDailyRate);

    return charge - credit;
  }
}
