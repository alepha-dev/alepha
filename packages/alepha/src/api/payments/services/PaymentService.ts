import { $inject, Alepha } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import {
  type PaymentIntentEntity,
  paymentIntents,
} from "../entities/paymentIntents.ts";
import { type RefundEntity, refunds } from "../entities/refunds.ts";
import { PaymentError } from "../errors/PaymentError.ts";
import { PaymentProvider } from "../providers/PaymentProvider.ts";

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
        if (intent.providerRef) {
          try {
            await this.provider.expireSession(intent.providerRef);
          } catch (error) {
            this.log.warn(
              `Failed to expire session for intent ${intent.id}`,
              error,
            );
          }
        }
        await this.intentRepo.updateById(intent.id, { status: "expired" });
        this.log.info(`Expired stale intent ${intent.id}`);
      }
    },
  });

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
  ): Promise<{ url: string; intentId: string }> {
    const intent = await this.getIntent(intentId);
    this.assertStatus(intent, "created", "createSession");

    // Verify intent ownership if userId is provided
    if (userId && intent.userId && intent.userId !== userId) {
      throw new PaymentError("Payment intent does not belong to this user");
    }

    // Associate intent with user if not already set
    if (userId && !intent.userId) {
      await this.intentRepo.updateById(intent.id, { userId });
    }

    const result = await this.provider.createSession(intent, {
      returnUrl,
      authorize,
    });

    await this.intentRepo.updateById(intent.id, {
      status: "processing",
      providerRef: result.providerRef,
    });

    return { url: result.url, intentId: intent.id };
  }

  /**
   * Handle an incoming webhook from the payment provider.
   */
  public async handleWebhook(request: Request): Promise<void> {
    const event = await this.provider.parseWebhook(request);
    const intents = await this.intentRepo.findMany({
      where: { providerRef: { eq: event.providerRef } },
      limit: 1,
    });

    if (intents.length === 0) {
      this.log.warn(`Webhook for unknown providerRef: ${event.providerRef}`);
      return;
    }

    const intent = intents[0];
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

    await this.intentRepo.updateById(intent.id, {
      status: webhookStatus,
      providerRaw: raw as any,
    });

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

    const updated = await this.intentRepo.updateById(intent.id, {
      status: "captured",
      amount,
    });

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

    const updated = await this.intentRepo.updateById(intent.id, {
      status: "voided",
    });

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
  ): Promise<RefundEntity> {
    const intent = await this.getIntent(intentId);

    // Allow refunds from both "captured" and "partially_refunded" states
    if (
      intent.status !== "captured" &&
      intent.status !== "partially_refunded"
    ) {
      throw new PaymentError(
        `Cannot refund: intent ${intent.id} is '${intent.status}', expected 'captured' or 'partially_refunded'`,
      );
    }

    // Validate refund amount against remaining refundable amount
    const existingRefunds = await this.refundRepo.findMany({
      where: { intentId: { eq: intent.id } },
    });
    const totalRefunded = existingRefunds.reduce((sum, r) => sum + r.amount, 0);
    const remaining = intent.amount - totalRefunded;

    if (amount > remaining) {
      throw new PaymentError(
        `Refund amount ${amount} exceeds remaining refundable amount ${remaining}`,
      );
    }

    let refundProviderRef: string | undefined;
    if (intent.providerRef) {
      const result = await this.provider.refundPayment(
        intent.providerRef,
        amount,
      );
      refundProviderRef = result.providerRef;
    }

    const refund = await this.refundRepo.create({
      intentId: intent.id,
      organizationId: intent.organizationId,
      amount,
      currency: intent.currency,
      status: "completed",
      reason,
      providerRef: refundProviderRef,
    });

    // Set status based on whether fully or partially refunded
    const newTotalRefunded = totalRefunded + amount;
    const newStatus =
      newTotalRefunded >= intent.amount ? "refunded" : "partially_refunded";
    await this.intentRepo.updateById(intent.id, {
      status: newStatus,
    });

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

    const cancelled = await this.intentRepo.updateById(intent.id, {
      status: "cancelled",
    });

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
}
