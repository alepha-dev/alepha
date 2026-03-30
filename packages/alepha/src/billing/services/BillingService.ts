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
import { BillingError } from "../errors/BillingError.ts";
import { BillingProvider } from "../providers/BillingProvider.ts";

export class BillingService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly provider = $inject(BillingProvider);
  protected readonly intentRepo = $repository(paymentIntents);
  protected readonly refundRepo = $repository(refunds);

  /**
   * Expires stale payment intents that have been in "processing" status
   * for more than 30 minutes. Runs every 15 minutes.
   */
  protected readonly expireStaleIntents = $job({
    cron: "*/15 * * * *",
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
      currency,
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
  ): Promise<{ url: string; intentId: string }> {
    const intent = await this.getIntent(intentId);
    this.assertStatus(intent, "created", "createSession");

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
   * the corresponding billing event.
   */
  public async handleWebhookEvent(
    intentId: string,
    status: string,
    raw?: unknown,
  ): Promise<void> {
    const intent = await this.getIntent(intentId);

    const eventMap = {
      authorized: "billing:authorized",
      captured: "billing:captured",
      failed: "billing:failed",
    } as const;

    type WebhookStatus = keyof typeof eventMap;
    if (!(status in eventMap)) {
      this.log.warn(`Unknown webhook status: ${status}`);
      return;
    }

    const webhookStatus = status as WebhookStatus;

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
    if (intent.providerRef) {
      await this.provider.capturePayment(intent.providerRef, amount);
    }

    const updated = await this.intentRepo.updateById(intent.id, {
      status: "captured",
      amount,
    });

    await this.alepha.events.emit("billing:captured", {
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

    await this.alepha.events.emit("billing:voided", {
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
    this.assertStatus(intent, "captured", "refund");

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

    await this.intentRepo.updateById(intent.id, { status: "refunded" });

    await this.alepha.events.emit("billing:refunded", {
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
      currency,
      status: "captured",
      metadata: metadata as any,
    });

    await this.alepha.events.emit("billing:captured", {
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

    return await this.intentRepo.updateById(intent.id, {
      status: "cancelled",
    });
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
      throw new BillingError(
        `Cannot ${operation}: intent ${intent.id} is '${intent.status}', expected '${expected}'`,
      );
    }
  }
}
