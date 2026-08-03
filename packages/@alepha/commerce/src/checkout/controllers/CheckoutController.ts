import { $inject, z } from "alepha";
import { $action } from "alepha/server";
import { CartController } from "../../cart/controllers/CartController.ts";
import { orderItems } from "../../entities/orderItems.ts";
import { orders } from "../../entities/orders.ts";
import { addressInputSchema } from "../entities/addresses.ts";
import { CheckoutService } from "../services/CheckoutService.ts";

const sessionSchema = z.object({
  id: z.uuid(),
  status: z.text(),
  subtotal: z.integer(),
  shippingTotal: z.integer(),
  taxTotal: z.integer(),
  grandTotal: z.integer(),
  currency: z.text(),
  orderId: z.uuid().optional(),
});

/**
 * The checkout as a storefront drives it.
 *
 * Note what {@link capabilities} is for: a storefront asks what the installed
 * payment rail can do and renders accordingly, instead of hard-coding a
 * redirect button or a card field. Swapping the provider changes no front-end
 * code.
 */
export class CheckoutController {
  protected readonly url = "/commerce/checkout";
  protected readonly group = "commerce:checkout";
  protected readonly checkout = $inject(CheckoutService);
  protected readonly cartController = $inject(CartController);

  public readonly commerceCheckoutCapabilities = $action({
    method: "GET",
    path: `${this.url}/capabilities`,
    group: this.group,
    description: "What the installed payment rail supports",
    schema: {
      response: z.object({
        modes: z.array(z.text()),
        collectsShippingAddress: z.boolean(),
        computesTax: z.boolean(),
      }),
    },
    handler: async () => this.checkout.capabilities(),
  });

  public readonly commerceCheckoutStart = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    description: "Open a checkout for the current cart",
    schema: {
      body: z.object({ email: z.email().optional() }),
      response: sessionSchema,
    },
    handler: async ({ body }) => {
      const cart = await this.cartController.resolveCart();
      return this.checkout.start(cart.id, { email: body.email });
    },
  });

  public readonly commerceCheckoutSetEmail = $action({
    method: "PUT",
    path: `${this.url}/:id/email`,
    group: this.group,
    description: "Record the buyer's email",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ email: z.email() }),
      response: sessionSchema,
    },
    handler: async ({ params, body }) =>
      this.checkout.setEmail(params.id, body.email),
  });

  public readonly commerceCheckoutSetAddress = $action({
    method: "PUT",
    path: `${this.url}/:id/address`,
    group: this.group,
    description: "Record the delivery address and re-price",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: addressInputSchema,
      response: sessionSchema,
    },
    handler: async ({ params, body }) =>
      this.checkout.setAddress(params.id, body),
  });

  public readonly commerceCheckoutShippingOptions = $action({
    method: "GET",
    path: `${this.url}/:id/shipping`,
    group: this.group,
    description: "Delivery options for this checkout's destination",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({
        options: z.array(
          z.object({
            code: z.text(),
            name: z.text(),
            price: z.integer(),
            minDays: z.integer().optional(),
            maxDays: z.integer().optional(),
          }),
        ),
      }),
    },
    handler: async ({ params }) => ({
      options: await this.checkout.shippingOptions(params.id),
    }),
  });

  public readonly commerceCheckoutSetShippingMethod = $action({
    method: "PUT",
    path: `${this.url}/:id/shipping`,
    group: this.group,
    description: "Choose a delivery option and re-price",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ code: z.text({ minLength: 1, maxLength: 64 }) }),
      response: sessionSchema,
    },
    handler: async ({ params, body }) =>
      this.checkout.setShippingMethod(params.id, body.code),
  });

  /**
   * What a confirmation page needs: the settled order, its lines, and any
   * invoice issued for it.
   *
   * ⚠️ The session id is the only credential, which is what makes it usable by a
   * guest who has no account. That is the same model as a hosted-checkout receipt
   * URL, and it is only safe because the id is a random uuid — never expose this
   * behind a guessable identifier, and gate it on ownership as soon as the shop
   * has accounts that matter.
   *
   * Invoice numbers are read through a hook rather than by importing the
   * invoicing module, so a deployment without it still gets a working
   * confirmation page.
   */
  public readonly commerceCheckoutOrder = $action({
    method: "GET",
    path: `${this.url}/:id/order`,
    group: this.group,
    description: "Read the order a checkout produced",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({
        order: orders.schema,
        items: z.array(orderItems.schema),
        factures: z.array(z.text()),
      }),
    },
    handler: async ({ params }) => this.checkout.confirmation(params.id),
  });

  public readonly commerceCheckoutPay = $action({
    method: "POST",
    path: `${this.url}/:id/pay`,
    group: this.group,
    description: "Create the order and hand off to the payment rail",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ returnUrl: z.text({ size: "rich" }) }),
      response: z.object({
        session: sessionSchema,
        // The handoff shape depends on the provider's mode, so it stays open.
        handoff: z.record(z.text(), z.any()),
      }),
    },
    handler: async ({ params, body }) => {
      const { session, handoff } = await this.checkout.pay(params.id, {
        returnUrl: body.returnUrl,
      });
      return { session, handoff } as any;
    },
  });
}
