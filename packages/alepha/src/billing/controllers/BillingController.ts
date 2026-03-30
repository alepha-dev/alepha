import { $inject, t } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";
import {
  checkoutResponseSchema,
  createCheckoutSchema,
} from "../schemas/intentSchemas.ts";
import {
  addPaymentMethodSchema,
  paymentMethodResourceSchema,
} from "../schemas/paymentMethodSchemas.ts";
import { BillingService } from "../services/BillingService.ts";
import { PaymentMethodService } from "../services/PaymentMethodService.ts";

export class BillingController {
  protected readonly url = "/billing";
  protected readonly group = "billing";
  protected readonly billing = $inject(BillingService);
  protected readonly paymentMethods = $inject(PaymentMethodService);

  /**
   * List the current user's saved payment methods.
   */
  public readonly listPaymentMethods = $action({
    path: `${this.url}/payment-methods`,
    group: this.group,
    use: [$secure()],
    description: "List current user's saved payment methods",
    schema: {
      response: t.array(paymentMethodResourceSchema),
    },
    handler: ({ user }) => this.paymentMethods.listPaymentMethods(user.id),
  });

  /**
   * Add a new payment method.
   */
  public readonly addPaymentMethod = $action({
    method: "POST",
    path: `${this.url}/payment-methods`,
    group: this.group,
    use: [$secure()],
    description: "Tokenize and store a new payment method",
    schema: {
      body: addPaymentMethodSchema,
      response: paymentMethodResourceSchema,
    },
    handler: ({ body, user }) =>
      this.paymentMethods.addPaymentMethod(
        user.id,
        user.organization!,
        body.token,
      ),
  });

  /**
   * Remove a payment method.
   */
  public readonly removePaymentMethod = $action({
    method: "DELETE",
    path: `${this.url}/payment-methods/:id`,
    group: this.group,
    use: [$secure()],
    description: "Remove own payment method",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.paymentMethods.removePaymentMethod(params.id, user.id);
      return { ok: true, id: params.id };
    },
  });

  /**
   * Set a payment method as default.
   */
  public readonly setDefaultPaymentMethod = $action({
    method: "PATCH",
    path: `${this.url}/payment-methods/:id/default`,
    group: this.group,
    use: [$secure()],
    description: "Set as default payment method",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: paymentMethodResourceSchema,
    },
    handler: ({ params, user }) =>
      this.paymentMethods.setDefault(params.id, user.id),
  });

  /**
   * Create a checkout session.
   */
  public readonly createCheckout = $action({
    method: "POST",
    path: `${this.url}/checkout`,
    group: this.group,
    use: [$secure()],
    description: "Create checkout session and return URL",
    schema: {
      body: createCheckoutSchema,
      response: checkoutResponseSchema,
    },
    handler: ({ body }) =>
      this.billing.createSession(body.intentId, body.returnUrl, body.authorize),
  });
}
