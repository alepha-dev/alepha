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

export interface MemoryCharge {
  providerRef: string;
  amount: number;
  status: string;
}

export interface MemoryRefund {
  providerRef: string;
  chargeRef: string;
  amount: number;
}

/**
 * The state the mock keeps, one bucket per kind of record. The keys are
 * provider references (or `account:idempotencyKey` for the replay buckets).
 */
export interface MemoryPaymentState {
  charges: MemoryCharge;
  sessionResults: CreateSessionResult;
  refundResults: RefundResult;
  refundRecords: MemoryRefund;
  methods: CreatePaymentMethodResult;
  methodOwners: { userId: string; account?: string; token: string };
  savedSessions: {
    userId: string;
    account?: string;
    method: CreatePaymentMethodResult;
    completed: boolean;
  };
  offSessionResults: OffSessionResult;
  expiredSessions: true;
}

export type MemoryPaymentBucket = keyof MemoryPaymentState;

/**
 * A payment provider that never moves money: every checkout is paid, every
 * card is a Visa 4242. For tests and local development.
 *
 * Its state lives in in-process Maps, so it only holds within one process.
 * Every read and write goes through {@link read}, {@link write} and
 * {@link remove}, which a subclass overrides to keep the state elsewhere: see
 * `DatabaseMemoryPaymentProvider`, for a deployment whose requests may each
 * run in a fresh isolate (Cloudflare Workers).
 */
export class MemoryPaymentProvider implements PaymentProvider {
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly state: {
    [B in MemoryPaymentBucket]: Map<string, MemoryPaymentState[B]>;
  } = {
    charges: new Map(),
    sessionResults: new Map(),
    refundResults: new Map(),
    refundRecords: new Map(),
    methods: new Map(),
    methodOwners: new Map(),
    savedSessions: new Map(),
    offSessionResults: new Map(),
    expiredSessions: new Map(),
  };

  protected async read<B extends MemoryPaymentBucket>(
    bucket: B,
    key: string,
  ): Promise<MemoryPaymentState[B] | undefined> {
    return this.state[bucket].get(key);
  }

  protected async write<B extends MemoryPaymentBucket>(
    bucket: B,
    key: string,
    value: MemoryPaymentState[B],
  ): Promise<void> {
    this.state[bucket].set(key, value);
  }

  protected async remove(
    bucket: MemoryPaymentBucket,
    key: string,
  ): Promise<void> {
    this.state[bucket].delete(key);
  }

  protected replayKey(options?: {
    stripeAccount?: string;
    idempotencyKey?: string;
  }): string | undefined {
    return options?.idempotencyKey
      ? `${options.stripeAccount ?? "platform"}:${options.idempotencyKey}`
      : undefined;
  }

  public async createSetupSession(
    userId: string,
    options: SetupSessionOptions,
  ): Promise<CreateSessionResult> {
    const providerRef = `mem_setup_${this.crypto.randomUUID()}`;
    const method = await this.createPaymentMethod(userId, "4242", options);
    await this.write("savedSessions", providerRef, {
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
    const session = await this.read("savedSessions", providerRef);
    if (!session || !providerRef.startsWith("mem_setup_"))
      throw new AlephaError("Unknown setup session");
    await this.write("savedSessions", providerRef, {
      ...session,
      completed: true,
    });
  }

  public async retrieveSavedPaymentMethod(
    userId: string,
    providerRef: string,
    options: ProviderAccountOptions = {},
  ): Promise<CreatePaymentMethodResult | null> {
    const session = await this.read("savedSessions", providerRef);
    if (!session) return null;
    if (session.userId !== userId || session.account !== options.stripeAccount)
      throw new AlephaError("Saved card belongs to another user or account");
    return session.completed &&
      (await this.read("methods", session.method.providerRef))
      ? session.method
      : null;
  }

  public async chargeOffSession(
    userId: string,
    paymentMethodRef: string,
    amount: number,
    options: OffSessionOptions,
  ): Promise<OffSessionResult> {
    const owner = await this.read("methodOwners", paymentMethodRef);
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
    const key = this.replayKey(options);
    const replay = key ? await this.read("offSessionResults", key) : undefined;
    if (replay) return replay;
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
    await this.write("charges", providerRef, {
      providerRef,
      amount,
      status: status === "succeeded" ? "captured" : status,
    });
    if (key) await this.write("offSessionResults", key, result);
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
    const key = this.replayKey(options);
    const replay = key ? await this.read("sessionResults", key) : undefined;
    if (replay) return replay;
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
      await this.write("savedSessions", providerRef, {
        userId: intent.userId,
        account: options.stripeAccount,
        method,
        completed: false,
      });
    }
    await this.write("charges", providerRef, {
      providerRef,
      amount: intent.amount,
      status,
    });
    const result = {
      url: `/payments/mock-checkout/${intent.id}?returnUrl=${encodeURIComponent(options.returnUrl)}`,
      providerRef,
    };
    if (key) await this.write("sessionResults", key, result);
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
    await this.write("charges", providerRef, {
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
    const charge = await this.read("charges", providerRef);
    if (charge) {
      const saved = await this.read("savedSessions", providerRef);
      if (saved)
        await this.write("savedSessions", providerRef, {
          ...saved,
          completed: true,
        });
      await this.write("charges", providerRef, {
        ...charge,
        status: "captured",
        amount,
      });
    }
  }

  public async voidPayment(providerRef: string): Promise<void> {
    const charge = await this.read("charges", providerRef);
    if (charge) {
      await this.write("charges", providerRef, { ...charge, status: "voided" });
    }
  }

  public async refundPayment(
    providerRef: string,
    amount: number,
    options?: ProviderAccountOptions,
  ): Promise<RefundResult> {
    const key = this.replayKey(options);
    const replay = key ? await this.read("refundResults", key) : undefined;
    if (replay) return replay;
    const refundRef = `mem_refund_${this.crypto.randomUUID()}`;
    await this.write("refundRecords", refundRef, {
      providerRef: refundRef,
      chargeRef: providerRef,
      amount,
    });
    const result = { providerRef: refundRef };
    if (key) await this.write("refundResults", key, result);
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
    await this.write("methods", providerRef, result);
    await this.write("methodOwners", providerRef, {
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
    if (!(await this.read("methods", providerRef))) return;
    const owner = await this.read("methodOwners", providerRef);
    if (owner?.account !== options.stripeAccount)
      throw new AlephaError("Wrong payment account");
    await this.remove("methods", providerRef);
    await this.remove("methodOwners", providerRef);
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
    await this.write("expiredSessions", providerRef, true);
  }

  // --- Test assertion helpers ---

  // They read the in-process Maps, so they only see what this instance wrote.

  public wasCharged(providerRef: string): boolean {
    const charge = this.state.charges.get(providerRef);
    return charge?.status === "captured";
  }

  public wasRefunded(providerRef: string): boolean {
    return Array.from(this.state.refundRecords.values()).some(
      (r) => r.chargeRef === providerRef,
    );
  }

  public wasExpired(providerRef: string): boolean {
    return this.state.expiredSessions.has(providerRef);
  }

  public getCharges(): MemoryCharge[] {
    return Array.from(this.state.charges.values());
  }

  public getRefunds(): MemoryRefund[] {
    return Array.from(this.state.refundRecords.values());
  }
}
