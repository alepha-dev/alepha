import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import type { PaymentIntentEntity } from "../entities/paymentIntents.ts";
import type {
  CreatePaymentMethodResult,
  CreateSessionResult,
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
