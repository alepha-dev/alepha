import { $module } from "alepha";
import { AdminBillingController } from "./controllers/AdminBillingController.ts";
import { BillingController } from "./controllers/BillingController.ts";
import { BillingProvider } from "./providers/BillingProvider.ts";
import { MemoryBillingProvider } from "./providers/MemoryBillingProvider.ts";
import { BillingService } from "./services/BillingService.ts";
import { PaymentMethodService } from "./services/PaymentMethodService.ts";

export * from "./controllers/AdminBillingController.ts";
export * from "./controllers/BillingController.ts";
export * from "./entities/paymentIntents.ts";
export * from "./entities/paymentMethods.ts";
export * from "./entities/refunds.ts";
export * from "./errors/BillingError.ts";
export * from "./providers/BillingProvider.ts";
export * from "./providers/MemoryBillingProvider.ts";
export * from "./schemas/intentSchemas.ts";
export * from "./schemas/paymentMethodSchemas.ts";
export * from "./schemas/refundSchemas.ts";
export * from "./services/BillingService.ts";
export * from "./services/PaymentMethodService.ts";

declare module "alepha" {
  interface Hooks {
    "billing:authorized": {
      intentId: string;
      amount: number;
      currency: string;
      metadata?: unknown;
    };
    "billing:captured": {
      intentId: string;
      amount: number;
      currency: string;
      metadata?: unknown;
    };
    "billing:failed": {
      intentId: string;
      amount: number;
      currency: string;
      metadata?: unknown;
    };
    "billing:voided": {
      intentId: string;
      amount: number;
      currency: string;
      metadata?: unknown;
    };
    "billing:refunded": {
      intentId: string;
      refundId: string;
      amount: number;
      currency: string;
      metadata?: unknown;
    };
  }
}

export const AlephaBilling = $module({
  name: "alepha.billing",
  services: [
    AdminBillingController,
    BillingController,
    BillingProvider,
    MemoryBillingProvider,
    BillingService,
    PaymentMethodService,
  ],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: BillingProvider,
      use: MemoryBillingProvider,
    });
  },
});
