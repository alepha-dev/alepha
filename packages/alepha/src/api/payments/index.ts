import { $module } from "alepha";
import { AdminPaymentController } from "./controllers/AdminPaymentController.ts";
import { MockCheckoutController } from "./controllers/MockCheckoutController.ts";
import { PaymentController } from "./controllers/PaymentController.ts";
import { MemoryPaymentProvider } from "./providers/MemoryPaymentProvider.ts";
import { PaymentProvider } from "./providers/PaymentProvider.ts";
import { PaymentMethodService } from "./services/PaymentMethodService.ts";
import { PaymentService } from "./services/PaymentService.ts";

export * from "./controllers/AdminPaymentController.ts";
export * from "./controllers/MockCheckoutController.ts";
export * from "./controllers/PaymentController.ts";
export * from "./entities/paymentIntents.ts";
export * from "./entities/paymentMethods.ts";
export * from "./entities/refunds.ts";
export * from "./errors/PaymentError.ts";
export * from "./providers/MemoryPaymentProvider.ts";
export * from "./providers/PaymentProvider.ts";
export * from "./schemas/intentSchemas.ts";
export * from "./schemas/paymentMethodSchemas.ts";
export * from "./schemas/refundSchemas.ts";
export * from "./services/PaymentMethodService.ts";
export * from "./services/PaymentService.ts";

declare module "alepha" {
  interface Hooks {
    "payments:authorized": {
      intentId: string;
      amount: number;
      currency: string;
      metadata?: unknown;
    };
    "payments:captured": {
      intentId: string;
      amount: number;
      currency: string;
      metadata?: unknown;
    };
    "payments:failed": {
      intentId: string;
      amount: number;
      currency: string;
      metadata?: unknown;
    };
    "payments:voided": {
      intentId: string;
      amount: number;
      currency: string;
      metadata?: unknown;
    };
    "payments:refunded": {
      intentId: string;
      refundId: string;
      amount: number;
      currency: string;
      metadata?: unknown;
    };
    "payments:cancelled": {
      intentId: string;
      amount: number;
      currency: string;
      metadata?: unknown;
    };
  }
}

/**
 * Provider-agnostic payments: intents, checkout sessions, capture, refunds,
 * webhooks, and admin operations. `MemoryPaymentProvider` is registered by
 * default; plug a PSP with `@alepha/payments-stripe` or
 * `@alepha/payments-mollie`.
 *
 * @module alepha.api.payments
 */
export const AlephaApiPayments = $module({
  name: "alepha.api.payments",
  services: [
    AdminPaymentController,
    PaymentController,
    MockCheckoutController,
    PaymentProvider,
    PaymentService,
    PaymentMethodService,
  ],
  variants: [MemoryPaymentProvider],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: PaymentProvider,
      use: MemoryPaymentProvider,
    });
  },
});
