import { $inject, AlephaError } from "alepha";
import { CryptoProvider } from "alepha/crypto";

import type { PaymentIntentEntity } from "../entities/paymentIntents.ts";
import type {
  CreatePaymentMethodResult,
  CreateSessionResult,
  ElementSessionResult,
  PaymentProvider,
  ProviderAccountOptions,
  SetupSessionOptions,
  OffSessionOptions,
  OffSessionResult,
  RefundResult,
  WebhookEvent,
} from "./PaymentProvider.ts";

interface MemoryCharge {
  providerRef: string;
  amount: number;
  status: string;
}

interface MemoryRefund {
  providerRef: string;
  chargeRef: string;
  amount: number;
}

export class MemoryPaymentProvider implements PaymentProvider {
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly charges: Map<string, MemoryCharge> = new Map();
  protected readonly sessionResults = new Map<string, CreateSessionResult>();
  protected readonly refundResults = new Map<string, RefundResult>();
  protected readonly refundRecords: Map<string, MemoryRefund> = new Map();
  protected readonly methods: Map<string, CreatePaymentMethodResult> =
    new Map();
  protected readonly expiredSessions: Set<string> = new Set();

  protected readonly methodOwners = new Map<
    string,
    { userId: string; account?: string; token: string }
  >();
  protected readonly savedSessions = new Map<
    string,
    {
      userId: string;
      account?: string;
      method: CreatePaymentMethodResult;
      completed: boolean;
    }
  >();
  protected readonly offSessionResults = new Map<string, OffSessionResult>();

  public async createSetupSession(
    userId: string,
    options: SetupSessionOptions,
  ): Promise<CreateSessionResult> {
    const providerRef = `mem_setup_${this.crypto.randomUUID()}`;
    const method = await this.createPaymentMethod(userId, "4242", options);
    this.savedSessions.set(providerRef, {
      userId,
      account: options.stripeAccount,
      method,
      completed: false,
    });
    return {
      providerRef,
      url: `/payments/mock-setup/${providerRef}?returnUrl=${encodeURIComponent(options.returnUrl)}`,
    };
  }

  public async completeSetupSession(providerRef: string): Promise<void> {
    const session = this.savedSessions.get(providerRef);
    if (!session || !providerRef.startsWith("mem_setup_"))
      throw new AlephaError("Unknown setup session");
    session.completed = true;
  }

  public async retrieveSavedPaymentMethod(
    userId: string,
    providerRef: string,
    options: ProviderAccountOptions = {},
  ): Promise<CreatePaymentMethodResult | null> {
    const session = this.savedSessions.get(providerRef);
    if (!session) return null;
    if (session.userId !== userId || session.account !== options.stripeAccount)
      throw new AlephaError("Saved card belongs to another user or account");
    return session.completed && this.methods.has(session.method.providerRef)
      ? session.method
      : null;
  }

  public async chargeOffSession(
    userId: string,
    paymentMethodRef: string,
    amount: number,
    options: OffSessionOptions,
  ): Promise<OffSessionResult> {
    const owner = this.methodOwners.get(paymentMethodRef);
    if (
      !owner ||
      owner.userId !== userId ||
      owner.account !== options.stripeAccount
    )
      throw new AlephaError(
        "Payment method belongs to another user or account",
      );
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new AlephaError("Charge amount must be a positive integer");
    const key = options.idempotencyKey
      ? `${options.stripeAccount ?? "platform"}:${options.idempotencyKey}`
      : undefined;
    if (key && this.offSessionResults.has(key))
      return this.offSessionResults.get(key)!;
    const status =
      owner.token === "authentication_required"
        ? "requires_action"
        : owner.token === "card_declined"
          ? "failed"
          : "succeeded";
    const providerRef = `mem_pi_${this.crypto.randomUUID()}`;
    const result: OffSessionResult = {
      status,
      providerRef,
      ...(status !== "succeeded" ? { code: owner.token } : {}),
    };
    this.charges.set(providerRef, {
      providerRef,
      amount,
      status: status === "succeeded" ? "captured" : status,
    });
    if (key) this.offSessionResults.set(key, result);
    return result;
  }

  public async createSession(
    intent: PaymentIntentEntity,
    options: {
      returnUrl: string;
      authorize?: boolean;
      saveCard?: boolean;
      stripeAccount?: string;
      applicationFeeAmount?: number;
      idempotencyKey?: string;
    },
  ): Promise<CreateSessionResult> {
    const key = options.idempotencyKey
      ? `${options.stripeAccount ?? "platform"}:${options.idempotencyKey}`
      : undefined;
    if (key && this.sessionResults.has(key))
      return this.sessionResults.get(key)!;
    const providerRef = `mem_session_${this.crypto.randomUUID()}`;
    const status = options.authorize ? "authorized" : "captured";
    if (options.saveCard) {
      if (!intent.userId)
        throw new AlephaError("Saving a card requires a user");
      const method = await this.createPaymentMethod(
        intent.userId,
        "4242",
        options,
      );
      this.savedSessions.set(providerRef, {
        userId: intent.userId,
        account: options.stripeAccount,
        method,
        completed: false,
      });
    }
    this.charges.set(providerRef, {
      providerRef,
      amount: intent.amount,
      status,
    });
    const result = {
      url: `/payments/mock-checkout/${intent.id}?returnUrl=${encodeURIComponent(options.returnUrl)}`,
      providerRef,
    };
    if (key) this.sessionResults.set(key, result);
    return result;
  }

  /**
   * A fake element session, so the embedded flow is exercisable in tests and in
   * local development without a PSP account.
   *
   * The `provider: "memory"` name is what a front-end dispatches on, and the
   * point of returning it here is that the agnostic slot can be tested end to
   * end: a renderer registered for `"memory"` stands in for Stripe's.
   */
  public async createElementSession(
    intent: PaymentIntentEntity,
  ): Promise<ElementSessionResult> {
    const providerRef = `mem_pi_${this.crypto.randomUUID()}`;
    this.charges.set(providerRef, {
      providerRef,
      amount: intent.amount,
      status: "captured",
    });
    return {
      clientSecret: `${providerRef}_secret_${this.crypto.randomText(16)}`,
      publishableKey: "pk_memory",
      provider: "memory",
      providerRef,
    };
  }

  public async capturePayment(
    providerRef: string,
    amount: number,
  ): Promise<void> {
    const charge = this.charges.get(providerRef);
    if (charge) {
      const saved = this.savedSessions.get(providerRef);
      if (saved) saved.completed = true;
      charge.status = "captured";
      charge.amount = amount;
    }
  }

  public async voidPayment(providerRef: string): Promise<void> {
    const charge = this.charges.get(providerRef);
    if (charge) {
      charge.status = "voided";
    }
  }

  public async refundPayment(
    providerRef: string,
    amount: number,
    options?: ProviderAccountOptions,
  ): Promise<RefundResult> {
    const key = options?.idempotencyKey
      ? `${options.stripeAccount ?? "platform"}:${options.idempotencyKey}`
      : undefined;
    if (key && this.refundResults.has(key)) return this.refundResults.get(key)!;
    const refundRef = `mem_refund_${this.crypto.randomUUID()}`;
    this.refundRecords.set(refundRef, {
      providerRef: refundRef,
      chargeRef: providerRef,
      amount,
    });
    const result = { providerRef: refundRef };
    if (key) this.refundResults.set(key, result);
    return result;
  }

  public async parseWebhook(request: Request): Promise<WebhookEvent> {
    const body = (await request.json()) as {
      providerRef: string;
      status: string;
    };
    return {
      providerRef: body.providerRef,
      status: body.status,
      raw: body,
    };
  }

  public async createPaymentMethod(
    userId: string,
    token: string,
    options: ProviderAccountOptions = {},
  ): Promise<CreatePaymentMethodResult> {
    const providerRef = `mem_pm_${this.crypto.randomUUID()}`;
    const result: CreatePaymentMethodResult = {
      providerRef,
      type: "card",
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
    };
    this.methods.set(providerRef, result);
    this.methodOwners.set(providerRef, {
      userId,
      account: options.stripeAccount,
      token,
    });
    return result;
  }

  public async deletePaymentMethod(
    providerRef: string,
    options: ProviderAccountOptions = {},
  ): Promise<void> {
    if (!this.methods.has(providerRef)) return;
    if (this.methodOwners.get(providerRef)?.account !== options.stripeAccount)
      throw new AlephaError("Wrong payment account");
    this.methods.delete(providerRef);
    this.methodOwners.delete(providerRef);
  }

  /**
   * Deliberately unpollable. The mock stamps every charge "captured" at
   * creation — that is what the charge WILL be if the buyer completes
   * the fake checkout, not what actually happened — so reporting it here
   * would make every abandoned-payment scenario auto-recover. A test
   * exercising reconciliation substitutes a subclass that answers.
   */
  public async retrieveSessionStatus(
    providerRef: string,
  ): Promise<"authorized" | "captured" | "failed" | null> {
    void providerRef;
    return null;
  }

  public async expireSession(providerRef: string): Promise<void> {
    this.expiredSessions.add(providerRef);
  }

  // --- Test assertion helpers ---

  public wasCharged(providerRef: string): boolean {
    const charge = this.charges.get(providerRef);
    return charge?.status === "captured";
  }

  public wasRefunded(providerRef: string): boolean {
    return Array.from(this.refundRecords.values()).some(
      (r) => r.chargeRef === providerRef,
    );
  }

  public wasExpired(providerRef: string): boolean {
    return this.expiredSessions.has(providerRef);
  }

  public getCharges(): MemoryCharge[] {
    return Array.from(this.charges.values());
  }

  public getRefunds(): MemoryRefund[] {
    return Array.from(this.refundRecords.values());
  }
}
