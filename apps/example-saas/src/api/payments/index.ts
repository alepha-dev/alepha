import { $module } from "alepha";
import { PaymentController } from "./controllers/PaymentController.ts";
import { StripeWebhookController } from "./controllers/StripeWebhookController.ts";
import { StripePaymentService } from "./services/StripePaymentService.ts";

export const SaasPayments = $module({
  name: "saas.api.payments",
  services: [StripePaymentService, PaymentController, StripeWebhookController],
});
