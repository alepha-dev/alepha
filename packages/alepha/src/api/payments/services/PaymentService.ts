import { $inject, Alepha } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, DbEntityNotFoundError } from "alepha/orm";
import {
  type PaymentIntentEntity,
  paymentIntents,
} from "../entities/paymentIntents.ts";
import { type RefundEntity, refunds } from "../entities/refunds.ts";
import { PaymentError } from "../errors/PaymentError.ts";
import {
  PaymentProvider,
  type WebhookEvent,
} from "../providers/PaymentProvider.ts";

export class PaymentService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly provider = $inject(PaymentProvider);
  protected readonly intentRepo = $repository(paymentIntents);
  protected readonly refundRepo = $repository(refunds);

  /**
   * Expires stale payment intents that have been in "processing" status
   * for more than 30 minutes. Runs every 5 minutes — shares the CF wrangler
   * trigger with the jobs sweep so no extra binding is consumed.
   */
  protected readonly expireStaleIntents = $job({
    name: "api:payments:expireStaleIntents",
    cron: "*/5 * * * *",
    handler: async () => {
      const cutoff = this.dateTime.now().subtract(30, "minutes").toISOString();

      const stale = await this.intentRepo.findMany({
        where: { status: { eq: "processing" }, createdAt: { lt: cutoff } },
      });

      for (const intent of stale) {
        await this.expireIntent(intent);
      }
    },
  });

  /**
   * Expire a single stale intent with a status-guarded claim: a webhook may
   * capture the payment between the sweep's read and this write, and a
   * captured payment must never be stomped to "expired".
   */
  public async expireIntent(intent: PaymentIntentEntity): Promise<void> {
    try {
      await this.intentRepo.updateOne(
        { id: { eq: intent.id }, status: { eq: "processing" } },
        { status: "expired" },
      );
    } catch (error) {
      if (error instanceof DbEntityNotFoundError) {
        this.log.info(
          `Skipping expiry: intent ${intent.id} is no longer processing`,
        );
        return;
      }
      throw error;
    }

    if (intent.providerRef) {
      try {
        await this.provider.expireSession(intent.providerRef);
      } catch (error) {
        this.log.warn(`Failed to expire session for intent ${intent.id}`, {
          error,
        });
      }
    }

    this.log.info(`Expired stale intent ${intent.id}`);
  }

  /**
   * Create a new payment intent in "created" status.
   */
  public async createIntent(
    amount: number,
    currency: string,
    metadata?: unknown,
    options?: { paymentMethodId?: string; userId?: string },
  ): Promise<PaymentIntentEntity> {
    return await this.intentRepo.create({
      amount,
      currency: currency.toLowerCase(),
      status: "created",
      metadata: metadata as any,
      paymentMethodId: options?.paymentMethodId,
      userId: options?.userId,
    });
  }

  /**
   * Create a checkout session with the payment provider and
   * transition the intent to "processing".
   */
  public async createSession(
    intentId: string,
    returnUrl: string,
    authorize?: boolean,
    userId?: string,
    options?: {
      stripeAccount?: string;
      applicationFeeAmount?: number;
      /**
       * Pre-fills the payer's email on the PSP checkout page. Useful when
       * the session runs on a sub-account (Stripe connected account) where
       * no customer object exists — without it the hosted checkout makes
       * the payer retype an address the platform already knows.
       */
      customerEmail?: string;
    },
  ): Promise<{ url: string; intentId: string }> {
    const intent = await this.getIntent(intentId);
    this.assertStatus(intent, "created", "createSession");

    // Verify intent ownership if userId is provided
    if (userId && intent.userId && intent.userId !== userId) {
      throw new PaymentError("Payment intent does not belong to this user");
    }

    // Claim the intent BEFORE the PSP call: two concurrent createSession
    // calls would otherwise both create sessions, and the loser's ref would
    // overwrite the winner's — orphaning the payment made against the first
    // session.
    try {
      await this.intentRepo.updateOne(
        { id: { eq: intent.id }, status: { eq: "created" } },
        {
          status: "processing",
          ...(userId && !intent.userId ? { userId } : {}),
        },
      );
    } catch (error) {
      if (error instanceof DbEntityNotFoundError) {
        throw new PaymentError(
          `Cannot createSession: intent ${intent.id} is already being processed`,
        );
      }
      throw error;
    }

    try {
      const result = await this.provider.createSession(intent, {
        returnUrl,
        authorize,
        stripeAccount: options?.stripeAccount,
        applicationFeeAmount: options?.applicationFeeAmount,
        customerEmail: options?.customerEmail,
      });

      await this.intentRepo.updateById(intent.id, {
        providerRef: result.providerRef,
      });

      return { url: result.url, intentId: intent.id };
    } catch (error) {
      // Release the claim so the intent isn't stuck in "processing" with no
      // session behind it.
      await this.intentRepo
        .updateOne(
          { id: { eq: intent.id }, status: { eq: "processing" } },
          { status: "created" },
        )
        .catch((releaseError) => {
          this.log.warn(
            `Failed to release intent ${intent.id} after session failure`,
            { error: releaseError },
          );
        });
      throw error;
    }
  }

  /**
   * Handle an incoming webhook from the payment provider.
   */
  public async handleWebhook(request: Request): Promise<void> {
    const event = await this.provider.parseWebhook(request);
    await this.handleParsedWebhook(event);
  }

  /**
   * Resolve an already-parsed webhook event to its stored intent and apply
   * it. Split from `handleWebhook` so callers that parse with a DIFFERENT
   * verification path (e.g. a connected-accounts endpoint that must first
   * route the event to a tenant) can reuse the matching + transition logic.
   */
  public async handleParsedWebhook(event: WebhookEvent): Promise<void> {
    let intents = await this.intentRepo.findMany({
      where: { providerRef: { eq: event.providerRef } },
      limit: 1,
    });

    // Session events reference two PSP objects (session + PaymentIntent);
    // the stored ref is whichever existed at creation time — try the other.
    if (intents.length === 0 && event.providerRefAlt) {
      intents = await this.intentRepo.findMany({
        where: { providerRef: { eq: event.providerRefAlt } },
        limit: 1,
      });
    }

    if (intents.length === 0) {
      this.log.warn(`Webhook for unknown providerRef: ${event.providerRef}`);
      return;
    }

    const intent = intents[0];

    // Session events put the session id in `providerRef` and the (lazily
    // created) PaymentIntent in `providerRefAlt`. When the stored ref is
    // still the session id, upgrade it to the PI as soon as an event
    // reveals it — refunds can only target the PI, never the session.
    if (
      event.providerRefAlt &&
      intent.providerRef === event.providerRef &&
      event.providerRefAlt !== event.providerRef
    ) {
      await this.intentRepo.updateById(intent.id, {
        providerRef: event.providerRefAlt,
      });
    }

    await this.handleWebhookEvent(intent.id, event.status, event.raw);
  }

  /**
   * Process a webhook event by updating the intent status and emitting
   * the corresponding payment event.
   */
  /**
   * Valid status transitions from webhook events.
   * Only these transitions are allowed — all others are silently ignored.
   */
  protected static readonly VALID_WEBHOOK_TRANSITIONS: Record<
    string,
    string[]
  > = {
    processing: ["authorized", "captured", "failed"],
    authorized: ["captured", "failed"],
  };

  public async handleWebhookEvent(
    intentId: string,
    status: string,
    raw?: unknown,
  ): Promise<void> {
    const intent = await this.getIntent(intentId);

    const eventMap = {
      authorized: "payments:authorized",
      captured: "payments:captured",
      failed: "payments:failed",
    } as const;

    type WebhookStatus = keyof typeof eventMap;
    if (!(status in eventMap)) {
      this.log.warn(`Unknown webhook status: ${status}`);
      return;
    }

    const webhookStatus = status as WebhookStatus;

    // Validate status transition
    const allowed = PaymentService.VALID_WEBHOOK_TRANSITIONS[intent.status];
    if (!allowed?.includes(webhookStatus)) {
      this.log.warn(
        `Ignoring webhook: cannot transition ${intent.status} → ${webhookStatus}`,
        { intentId: intent.id },
      );
      return;
    }

    // Guarded on the status we validated the transition against. Providers
    // retry webhooks and can deliver out of order, so two deliveries can pass
    // the table check against the same snapshot; only the first may write, or
    // the later one would re-emit a lifecycle event for a transition the
    // intent already left.
    const moved = await this.intentRepo
      .updateOne(
        { id: { eq: intent.id }, status: { eq: intent.status } },
        { status: webhookStatus, providerRaw: raw as any },
      )
      .catch(() => undefined);

    if (!moved) {
      this.log.warn(
        `Ignoring webhook: intent ${intent.id} left '${intent.status}' before the update landed`,
      );
      return;
    }

    await this.alepha.events.emit(eventMap[webhookStatus], {
      intentId: intent.id,
      amount: intent.amount,
      currency: intent.currency,
      metadata: intent.metadata,
    });
  }

  /**
   * Capture a previously authorized payment. Optionally specify a different
   * amount for partial capture.
   */
  public async capture(
    intentId: string,
    finalAmount?: number,
  ): Promise<PaymentIntentEntity> {
    const intent = await this.getIntent(intentId);
    this.assertStatus(intent, "authorized", "capture");

    const amount = finalAmount ?? intent.amount;
    if (amount > intent.amount) {
      throw new PaymentError(
        `Capture amount ${amount} exceeds authorized amount ${intent.amount}`,
      );
    }

    if (intent.providerRef) {
      await this.provider.capturePayment(intent.providerRef, amount);
    }

    const updated = await this.transition(
      intent.id,
      "authorized",
      { status: "captured", amount },
      "capture",
    );

    await this.alepha.events.emit("payments:captured", {
      intentId: intent.id,
      amount,
      currency: intent.currency,
      metadata: intent.metadata,
    });

    return updated;
  }

  /**
   * Void a previously authorized payment before capture.
   */
  public async void(intentId: string): Promise<PaymentIntentEntity> {
    const intent = await this.getIntent(intentId);
    this.assertStatus(intent, "authorized", "void");

    if (intent.providerRef) {
      await this.provider.voidPayment(intent.providerRef);
    }

    const updated = await this.transition(
      intent.id,
      "authorized",
      { status: "voided" },
      "void",
    );

    await this.alepha.events.emit("payments:voided", {
      intentId: intent.id,
      amount: intent.amount,
      currency: intent.currency,
      metadata: intent.metadata,
    });

    return updated;
  }

  /**
   * Refund a captured payment (partial or full).
   */
  public async refund(
    intentId: string,
    amount: number,
    reason?: string,
    options: {
      /**
       * PSP sub-account holding the charge (Stripe connected account) —
       * required to refund payments that were created with the same option,
       * e.g. direct charges on a club's connected account.
       */
      stripeAccount?: string;
    } = {},
  ): Promise<RefundEntity> {
    const intent = await this.getIntent(intentId);

    // Reserve the refund with a version-guarded claim. Two concurrent refunds
    // both reading the same refunded total would otherwise both pass the
    // remaining-amount check and over-refund (a verified race for cash
    // intents, which have no PSP to reject the excess).
    //
    // Deliberately NOT wrapped in `transactional()`: that would join an
    // ambient transaction when several refunds run in the same async context,
    // so one loser's rollback would erase the winner's reservation. The
    // version-guarded UPDATE is itself atomic, which is all the mutual
    // exclusion this needs — exactly one caller wins per version.
    const fresh = await this.getIntent(intentId);

    // Allow refunds from both "captured" and "partially_refunded" states
    if (fresh.status !== "captured" && fresh.status !== "partially_refunded") {
      throw new PaymentError(
        `Cannot refund: intent ${fresh.id} is '${fresh.status}', expected 'captured' or 'partially_refunded'`,
      );
    }

    // Validate refund amount against remaining refundable amount.
    // Pending refunds count as reserved; failed ones never happened.
    const existingRefunds = await this.refundRepo.findMany({
      where: { intentId: { eq: fresh.id }, status: { ne: "failed" } },
    });
    const totalRefunded = existingRefunds.reduce((sum, r) => sum + r.amount, 0);
    const remaining = fresh.amount - totalRefunded;

    if (amount > remaining) {
      throw new PaymentError(
        `Refund amount ${amount} exceeds remaining refundable amount ${remaining}`,
      );
    }

    // Insert the reservation BEFORE the version claim. Ordering matters:
    // callers read the version first and the refund rows second, so any
    // competitor that observes our bumped version is guaranteed to also see
    // this row in its refunded-total read. Claiming first opens a window
    // where a competitor sees the new version but not yet the new refund —
    // three concurrent 500s then all pass a "1000 remaining" check.
    const pending = await this.refundRepo.create({
      intentId: fresh.id,
      organizationId: fresh.organizationId,
      amount,
      currency: fresh.currency,
      status: "pending",
      reason,
    });

    try {
      await this.intentRepo.updateOne(
        { id: { eq: fresh.id }, version: { eq: fresh.version } },
        { version: (fresh.version ?? 0) + 1 },
      );
    } catch (error) {
      // Lost the claim — release the reservation so it stops counting
      // against the remaining refundable amount.
      await this.refundRepo.deleteById(pending.id).catch((releaseError) => {
        this.log.warn(`Failed to release refund reservation ${pending.id}`, {
          error: releaseError,
        });
      });
      if (error instanceof DbEntityNotFoundError) {
        throw new PaymentError(
          `Concurrent refund in progress for intent ${fresh.id}, retry`,
        );
      }
      throw error;
    }

    // PSP call outside any lock — network I/O must not hold one.
    let refundProviderRef: string | undefined;
    try {
      if (intent.providerRef) {
        const result = await this.provider.refundPayment(
          intent.providerRef,
          amount,
          options,
        );
        refundProviderRef = result.providerRef;
      }
    } catch (error) {
      // Release the reservation — a failed refund must not count against
      // the remaining refundable amount.
      await this.refundRepo
        .updateById(pending.id, { status: "failed" })
        .catch((releaseError) => {
          this.log.warn(
            `Failed to mark refund ${pending.id} as failed after PSP error`,
            { error: releaseError },
          );
        });
      throw error;
    }

    const refund = await this.refundRepo.updateById(pending.id, {
      status: "completed",
      providerRef: refundProviderRef,
    });

    // Set status from the refunded total as recorded in the database.
    const allRefunds = await this.refundRepo.findMany({
      where: { intentId: { eq: intent.id }, status: { ne: "failed" } },
    });
    const newTotalRefunded = allRefunds.reduce((sum, r) => sum + r.amount, 0);
    const newStatus =
      newTotalRefunded >= intent.amount ? "refunded" : "partially_refunded";
    await this.intentRepo.updateOne(
      { id: { eq: intent.id } },
      { status: newStatus },
    );

    await this.alepha.events.emit("payments:refunded", {
      intentId: intent.id,
      refundId: refund.id,
      amount,
      currency: intent.currency,
      metadata: intent.metadata,
    });

    return refund;
  }

  /**
   * Record a cash or offline payment directly as captured,
   * bypassing the checkout flow.
   */
  public async recordCashPayment(
    amount: number,
    currency: string,
    metadata?: unknown,
  ): Promise<PaymentIntentEntity> {
    const intent = await this.intentRepo.create({
      amount,
      currency: currency.toLowerCase(),
      status: "captured",
      metadata: metadata as any,
    });

    await this.alepha.events.emit("payments:captured", {
      intentId: intent.id,
      amount,
      currency,
      metadata,
    });

    return intent;
  }

  /**
   * Cancel a payment intent that has not yet entered processing.
   */
  public async cancel(intentId: string): Promise<PaymentIntentEntity> {
    const intent = await this.getIntent(intentId);
    this.assertStatus(intent, "created", "cancel");

    const cancelled = await this.transition(
      intent.id,
      "created",
      { status: "cancelled" },
      "cancel",
    );

    await this.alepha.events.emit("payments:cancelled", {
      intentId: intent.id,
      amount: intent.amount,
      currency: intent.currency,
      metadata: intent.metadata,
    });

    return cancelled;
  }

  /**
   * Get a payment intent by ID. Throws NotFoundError if not found.
   */
  public async getIntent(intentId: string): Promise<PaymentIntentEntity> {
    return await this.intentRepo.getById(intentId);
  }

  /**
   * Find payment intents with optional filters and pagination.
   */
  public async findIntents(query: {
    status?: string;
    userId?: string;
    sort?: string;
    size?: number;
    page?: number;
  }) {
    const where = this.intentRepo.createQueryWhere();
    if (query.status)
      where.status = { eq: query.status as PaymentIntentEntity["status"] };
    if (query.userId) where.userId = { eq: query.userId };
    return await this.intentRepo.paginate(query, { where }, { count: true });
  }

  protected assertStatus(
    intent: PaymentIntentEntity,
    expected: PaymentIntentEntity["status"],
    operation: string,
  ): void {
    if (intent.status !== expected) {
      throw new PaymentError(
        `Cannot ${operation}: intent ${intent.id} is '${intent.status}', expected '${expected}'`,
      );
    }
  }

  /**
   * Move an intent from one status to another, refusing the write if the row
   * left `from` in the meantime.
   *
   * `assertStatus` only ever describes the *snapshot* the caller read. Between
   * that read and the write, a webhook or a second operator can move the row —
   * and an unguarded `updateById` would happily overwrite them, emitting a
   * second lifecycle event for a transition that never legitimately happened.
   * Folding the expected status into the WHERE clause makes the check and the
   * write one atomic statement.
   */
  protected async transition(
    intentId: string,
    from: PaymentIntentEntity["status"],
    data: Record<string, unknown>,
    operation: string,
  ): Promise<PaymentIntentEntity> {
    const updated = await this.intentRepo
      .updateOne({ id: { eq: intentId }, status: { eq: from } }, data as never)
      .catch(() => undefined);

    if (!updated) {
      const current = await this.getIntent(intentId);
      throw new PaymentError(
        `Cannot ${operation}: intent ${intentId} is '${current.status}', expected '${from}'`,
      );
    }

    return updated;
  }
}
