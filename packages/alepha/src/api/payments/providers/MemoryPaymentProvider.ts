import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import type { PaymentIntentEntity } from "../entities/paymentIntents.ts";
import type {
  CreatePaymentMethodResult,
  CreateSessionResult,
  ElementSessionResult,
  PaymentProvider,
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
  protected readonly refundRecords: Map<string, MemoryRefund> = new Map();
  protected readonly methods: Map<string, CreatePaymentMethodResult> =
    new Map();
  protected readonly expiredSessions: Set<string> = new Set();

  public async createSession(
    intent: PaymentIntentEntity,
    options: {
      returnUrl: string;
      authorize?: boolean;
      stripeAccount?: string;
      applicationFeeAmount?: number;
    },
  ): Promise<CreateSessionResult> {
    const providerRef = `mem_session_${this.crypto.randomUUID()}`;
    const status = options.authorize ? "authorized" : "captured";
    this.charges.set(providerRef, {
      providerRef,
      amount: intent.amount,
      status,
    });
    return {
      url: `/payments/mock-checkout/${intent.id}?returnUrl=${encodeURIComponent(options.returnUrl)}`,
      providerRef,
    };
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
    };
  }

  public async capturePayment(
    providerRef: string,
    amount: number,
  ): Promise<void> {
    const charge = this.charges.get(providerRef);
    if (charge) {
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
  ): Promise<RefundResult> {
    const refundRef = `mem_refund_${this.crypto.randomUUID()}`;
    this.refundRecords.set(refundRef, {
      providerRef: refundRef,
      chargeRef: providerRef,
      amount,
    });
    return { providerRef: refundRef };
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
    _userId: string,
    _token: string,
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
    return result;
  }

  public async deletePaymentMethod(providerRef: string): Promise<void> {
    this.methods.delete(providerRef);
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
