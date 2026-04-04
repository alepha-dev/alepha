import { $module } from "alepha";
import { AdminPaymentController } from "./controllers/AdminPaymentController.ts";
import { PaymentController } from "./controllers/PaymentController.ts";
import { MemoryPaymentProvider } from "./providers/MemoryPaymentProvider.ts";
import { PaymentProvider } from "./providers/PaymentProvider.ts";
import { PaymentMethodService } from "./services/PaymentMethodService.ts";
import { PaymentService } from "./services/PaymentService.ts";

export * from "./controllers/AdminPaymentController.ts";
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
  }
}

export const AlephaPayments = $module({
  name: "alepha.payments",
  services: [
    AdminPaymentController,
    PaymentController,
    PaymentProvider,
    MemoryPaymentProvider,
    PaymentService,
    PaymentMethodService,
  ],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: PaymentProvider,
      use: MemoryPaymentProvider,
    });
  },
});
