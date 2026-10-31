import { $inject, $store, Alepha, z } from "alepha";
import { currentUserAtom } from "alepha/security";
import { $action, BadRequestError, ForbiddenError } from "alepha/server";
import { safeRedirectPath } from "alepha/server/auth";

import { CartController } from "../../cart/controllers/CartController.ts";
import { publicOrderItemSchema } from "../../schemas/publicOrderItemSchema.ts";
import { publicOrderSchema } from "../../schemas/publicOrderSchema.ts";
import { checkoutConfig } from "../checkoutConfigAtom.ts";
import { addressInputSchema } from "../entities/addresses.ts";
import type { CheckoutSessionEntity } from "../entities/checkoutSessions.ts";
import { CheckoutService } from "../services/CheckoutService.ts";

const sessionSchema = z.object({
  id: z.uuid(),
  status: z.text(),
  subtotal: z.integer(),
  discountTotal: z.integer(),
  shippingTotal: z.integer(),
  taxTotal: z.integer(),
  grandTotal: z.integer(),
  currency: z.text(),
  orderId: z.uuid().optional(),
  vatNumber: z.text().optional(),
});

/**
 * The checkout as a storefront drives it.
 *
 * Note what {@link capabilities} is for: a storefront asks what the installed
 * payment rail can do and renders accordingly, instead of hard-coding a
 * redirect button or a card field. Swapping the provider changes no front-end
 * code.
 *
 * ### Whose checkout it is
 *
 * The session id is not a credential: it travels in URLs, so in logs and
 * referrers. Every action on a session checks the caller holds its cart's signed
 * cookie or is its signed-in user, through {@link assertOwned}. The one exception
 * is the confirmation, see {@link commerceCheckoutOrder}.
 */
export class CheckoutController {
  protected readonly url = "/commerce/checkout";
  protected readonly group = "commerce:checkout";
  protected readonly alepha = $inject(Alepha);
  protected readonly checkout = $inject(CheckoutService);
  protected readonly cartController = $inject(CartController);
  protected readonly config = $store(checkoutConfig);

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
      body: z.object({
        email: z.email().optional(),
        recoveryConsent: z.boolean().optional(),
      }),
      response: sessionSchema,
    },
    handler: async ({ body }) => {
      const cart = await this.cartController.resolveCart();
      // From the CART, not from the request: `resolveCart` has already decided
      // whose cart this is, including folding a guest basket into an account
      // one. Re-reading the identity here could disagree with it.
      return this.checkout.start(cart.id, {
        userId: cart.userId,
        email: body.email,
        recoveryConsent: body.recoveryConsent,
      });
    },
  });

  public readonly commerceCheckoutSetEmail = $action({
    method: "PUT",
    path: `${this.url}/:id/email`,
    group: this.group,
    description: "Record the buyer's email",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({
        email: z.email(),
        /**
         * The buyer's answer to being reminded about this cart. Never
         * pre-ticked: an unticked box is the only consent that means anything.
         */
        recoveryConsent: z.boolean().optional(),
      }),
      response: sessionSchema,
    },
    handler: async ({ params, body }) => {
      await this.assertOwned(params.id);
      return this.checkout.setEmail(params.id, body.email, {
        recoveryConsent: body.recoveryConsent,
      });
    },
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
    handler: async ({ params, body }) => {
      await this.assertOwned(params.id);
      return this.checkout.setAddress(params.id, body);
    },
  });

  /**
   * A business buyer's VAT number, checked with the registry before it counts.
   * Sent empty, it takes the number off.
   */
  public readonly commerceCheckoutSetVatNumber = $action({
    method: "PUT",
    path: `${this.url}/:id/vat-number`,
    group: this.group,
    description: "Record a business buyer's VAT number and re-price",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ vatNumber: z.text({ maxLength: 32 }).optional() }),
      response: sessionSchema,
    },
    handler: async ({ params, body }) => {
      await this.assertOwned(params.id);
      return this.checkout.setVatNumber(params.id, body.vatNumber);
    },
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
    handler: async ({ params }) => {
      await this.assertOwned(params.id);
      return { options: await this.checkout.shippingOptions(params.id) };
    },
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
    handler: async ({ params, body }) => {
      await this.assertOwned(params.id);
      return this.checkout.setShippingMethod(params.id, body.code);
    },
  });

  /**
   * What a confirmation page needs: the settled order, its lines, and any
   * invoice issued for it.
   *
   * ⚠️ The one action a session id alone may reach. A bank's app often sends the
   * buyer back in another browser, with no cookie, and a stranger's refusal
   * there would read as a payment gone wrong. So nobody is refused, and what
   * crosses the wire is {@link publicOrderSchema}: no payment reference, no
   * account, and no address unless the caller owns the session.
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
        order: publicOrderSchema,
        items: z.array(publicOrderItemSchema),
        factures: z.array(z.text()),
        downloads: z.array(
          z.object({
            name: z.text(),
            url: z.text({ maxLength: 500 }),
            expiresAt: z.text(),
          }),
        ),
      }),
    },
    handler: async ({ params }) => {
      const session = await this.checkout.getById(params.id);
      const confirmation = await this.checkout.confirmation(params.id);
      const owned = await this.owns(session);
      return {
        ...confirmation,
        order: {
          ...confirmation.order,
          shippingAddress: owned
            ? confirmation.order.shippingAddress
            : undefined,
        },
        downloads: owned ? confirmation.downloads : [],
      } as any;
    },
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
    // `url` renamed: the controller's own `this.url` is the route prefix, and
    // two things called `url` in one scope is one too many.
    handler: async ({ params, body, url: requestUrl }) => {
      await this.assertOwned(params.id);
      const { session, handoff } = await this.checkout.pay(params.id, {
        returnUrl: this.resolveReturnUrl(body.returnUrl, requestUrl),
      });
      return { session, handoff } as any;
    },
  });

  /**
   * Refuse a caller who did not open this checkout.
   *
   * @throws ForbiddenError
   */
  protected async assertOwned(sessionId: string): Promise<void> {
    if (!(await this.owns(await this.checkout.getById(sessionId)))) {
      throw new ForbiddenError("This checkout is not yours.");
    }
  }

  /**
   * Whether the caller holds the session's cart, by its signed cookie, or is
   * its signed-in user.
   */
  protected async owns(session: CheckoutSessionEntity): Promise<boolean> {
    const userId = this.alepha.store.get(currentUserAtom)?.id;
    if (session.userId && session.userId === userId) {
      return true;
    }
    const cart = await this.cartController.currentCart();
    return cart?.id === session.cartId;
  }

  /**
   * Turn the client's `returnUrl` into an absolute URL that can only point
   * back at this shop.
   *
   * It used to be handed to the payment rail verbatim, so a crafted request
   * could park any address on the customer's post-payment redirect - the
   * classic open redirect, made worse by arriving at the moment the customer
   * has just typed card details and is primed to trust what they see next.
   *
   * Two shapes are accepted:
   *
   * - **A path.** The form to prefer, and the only one a storefront needs.
   *   Validated by `safeRedirectPath`, the same rule the auth module uses, so
   *   `//evil.example` and backslash tricks are rejected rather than
   *   normalised into another origin by the browser. Resolved against the
   *   configured `baseUrl`.
   * - **An absolute URL back to the same origin.** Kept because the rail
   *   needs an absolute URL anyway and some storefronts build one themselves.
   *
   * Anything else is a 400, not a silent rewrite to the home page: a client
   * sending a foreign origin has a bug or is an attack, and neither is served
   * by pretending the request was fine.
   */
  protected resolveReturnUrl(returnUrl: string, requestUrl: URL): string {
    // Configured origin wins. The request's own is a sane default for a
    // single-origin shop, and is what the customer's browser is on.
    const base = this.config.baseUrl || requestUrl.origin;

    const path = safeRedirectPath(returnUrl, "");
    if (path) {
      return new URL(path, base).toString();
    }

    try {
      const parsed = new URL(returnUrl);
      if (parsed.origin === new URL(base).origin) {
        return parsed.toString();
      }
    } catch {
      // Not a URL at all — falls through to the rejection below.
    }

    throw new BadRequestError(
      `returnUrl must be a path or an absolute URL on ${new URL(base).origin}.`,
    );
  }
}
