import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, DatabaseProvider } from "alepha/orm";

import { CartService } from "../../cart/services/CartService.ts";
import { CommerceError } from "../../errors/CommerceError.ts";
import { OrderService } from "../../services/OrderService.ts";
import type { AddressInput } from "../entities/addresses.ts";
import {
  type CheckoutSessionEntity,
  checkoutSessions,
} from "../entities/checkoutSessions.ts";
import type { PaymentHandoff } from "../providers/CheckoutPaymentProvider.ts";
import { CheckoutPaymentProvider } from "../providers/CheckoutPaymentProvider.ts";
import { OrderDocumentsProvider } from "../providers/OrderDocumentsProvider.ts";
import type { CheckoutShippingQuote } from "../providers/ShippingQuoteProvider.ts";
import { ShippingQuoteProvider } from "../providers/ShippingQuoteProvider.ts";
import { AddressService } from "./AddressService.ts";
import { TaxService } from "./TaxService.ts";

/**
 * Totals for a checkout, all in the smallest currency unit.
 */
export interface CheckoutTotals {
  subtotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  currency: string;
}

/**
 * Drives one checkout from a cart to a paid order.
 *
 * The flow is deliberately three explicit steps rather than one call:
 * {@link start} opens a session against a cart, {@link setDetails} collects
 * what is needed, {@link pay} freezes the totals into an order and hands off to
 * the payment rail. Settlement arrives separately, via {@link settle}, because
 * it is driven by a webhook and not by the customer's browser.
 */
export class CheckoutService {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly db = $inject(DatabaseProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly repo = $repository(checkoutSessions);
  protected readonly carts = $inject(CartService);
  protected readonly orders = $inject(OrderService);
  protected readonly tax = $inject(TaxService);
  protected readonly payment = $inject(CheckoutPaymentProvider);
  protected readonly addresses = $inject(AddressService);
  protected readonly shipping = $inject(ShippingQuoteProvider);
  protected readonly documents = $inject(OrderDocumentsProvider);

  /**
   * Open a checkout for a cart, reusing an already-open one for the same cart.
   *
   * Reuse matters: a customer who reloads the checkout page must not strand a
   * session behind, or the abandoned-checkout figures become meaningless.
   */
  public async start(
    cartId: string,
    options: { userId?: string; email?: string } = {},
  ): Promise<CheckoutSessionEntity> {
    const existing = await this.repo.findOne({
      where: { cartId: { eq: cartId }, status: { eq: "open" } },
    });

    const totals = await this.computeTotals(cartId);

    if (existing) {
      return this.repo.updateById(existing.id, totals);
    }

    const session = await this.repo.create({
      cartId,
      userId: options.userId,
      email: options.email,
      status: "open",
      ...totals,
    });

    if (session.email) {
      await this.emitEmailCaptured(session.id, cartId, session.email);
    }

    return session;
  }

  /**
   * Record the buyer's email. Kept separate from the address so a shop can ask
   * for it first and use it for abandoned-cart follow-up.
   */
  public async setEmail(
    sessionId: string,
    email: string,
  ): Promise<CheckoutSessionEntity> {
    const session = await this.repo.getById(sessionId);
    this.assertOpen(session);
    const updated = await this.repo.updateById(sessionId, { email });
    await this.emitEmailCaptured(updated.id, updated.cartId, email);
    return updated;
  }

  /**
   * Announce a captured email once the write is committed — deferred via
   * afterCommit for the same reason as the order events: this method can
   * be reached from inside a caller's transaction, and subscribers must
   * read committed rows.
   */
  protected async emitEmailCaptured(
    sessionId: string,
    cartId: string,
    email: string,
  ): Promise<void> {
    await this.db.afterCommit(() =>
      this.alepha.events.emit(
        "commerce:checkout:email",
        { sessionId, cartId, email },
        { catch: true },
      ),
    );
  }

  /**
   * Record the delivery address, after validating it against its country's
   * rules, and re-price — because the destination is what decides delivery cost.
   *
   * Clears any previously chosen `shippingMethod`: a method valid for France is
   * not necessarily offered for Malta, and silently keeping a stale choice is
   * how a parcel gets charged at the wrong rate.
   *
   * @throws InvalidAddressError
   */
  public async setAddress(
    sessionId: string,
    address: AddressInput,
  ): Promise<CheckoutSessionEntity> {
    const session = await this.repo.getById(sessionId);
    this.assertOpen(session);

    const clean = this.addresses.validate(address);
    const totals = await this.computeTotals(session.cartId, clean.country);

    return this.repo.updateById(sessionId, {
      shippingAddress: clean,
      shippingMethod: null,
      ...totals,
    });
  }

  /**
   * The delivery options for this checkout's destination.
   *
   * @throws CommerceError when no address has been recorded yet
   */
  public async shippingOptions(
    sessionId: string,
  ): Promise<CheckoutShippingQuote[]> {
    const session = await this.repo.getById(sessionId);
    const country = this.countryOf(session);
    if (!country) {
      throw new CommerceError(
        `Checkout ${sessionId} has no address yet — call setAddress() first.`,
      );
    }
    const priced = await this.carts.price(session.cartId);
    return this.shipping.quote(country, priced.subtotal);
  }

  /**
   * Choose a delivery option, and re-price.
   *
   * @throws CommerceError when the code is not offered for this destination
   */
  public async setShippingMethod(
    sessionId: string,
    code: string,
  ): Promise<CheckoutSessionEntity> {
    const session = await this.repo.getById(sessionId);
    this.assertOpen(session);

    const country = this.countryOf(session);
    if (!country) {
      throw new CommerceError(
        `Checkout ${sessionId} has no address yet — call setAddress() first.`,
      );
    }

    const priced = await this.carts.price(session.cartId);
    const quote = await this.shipping.quoteFor(country, priced.subtotal, code);
    if (!quote) {
      throw new CommerceError(
        `'${code}' is not an available delivery option for ${country}.`,
      );
    }

    const totals = this.totalsOf(priced, quote);
    return this.repo.updateById(sessionId, {
      shippingMethod: quote.code,
      ...totals,
    });
  }

  /**
   * Freeze the totals into a pending order and hand off to the payment rail.
   *
   * Totals are recomputed here, not taken from the session: the row may have
   * been written minutes ago and the catalogue can move underneath it. The
   * figure the customer is charged is the one computed at this instant, and it
   * is the same code path that priced the cart on screen.
   */
  public async pay(
    sessionId: string,
    options: { returnUrl: string },
  ): Promise<{ session: CheckoutSessionEntity; handoff: PaymentHandoff }> {
    const session = await this.repo.getById(sessionId);
    this.assertOpen(session);

    const priced = await this.carts.price(session.cartId);
    if (priced.lines.length === 0) {
      throw new CommerceError("Cannot pay for an empty cart.");
    }

    // Re-quote the chosen method rather than trusting the stored total: the row
    // may be minutes old, and a rate can have changed or been withdrawn. If the
    // buyer's selection is no longer offered, stop — charging them a different
    // delivery price than the one they accepted is not a recoverable mistake.
    let quote: CheckoutShippingQuote | undefined;
    const country = this.countryOf(session);
    if (session.shippingMethod && country) {
      quote = await this.shipping.quoteFor(
        country,
        priced.subtotal,
        session.shippingMethod,
      );
      if (!quote) {
        throw new CommerceError(
          `Delivery option '${session.shippingMethod}' is no longer available for ${country}. Ask the buyer to choose again.`,
        );
      }
    }

    const totals = this.totalsOf(priced, quote);

    const order = await this.orders.create({
      userId: session.userId,
      status: "pending",
      lines: priced.lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
      })),
      shippingMethod: session.shippingMethod,
      shippingAddress: session.shippingAddress as
        | Record<string, any>
        | undefined,
      // Pass the freshly re-quoted figures, so the order's `total` is exactly
      // what the payment rail is about to charge.
      shippingTotal: totals.shippingTotal,
      taxTotal: totals.taxTotal,
    });

    // The invariant that matters in this whole file: the order says exactly what
    // the card is about to be charged. It was briefly false — the order total
    // excluded delivery — and the only reason it is not still false is that a
    // test compared the two numbers. Assert it rather than trust it.
    if (order.total !== totals.grandTotal) {
      throw new CommerceError(
        `Order total ${order.total} does not match the amount to charge ${totals.grandTotal} for checkout ${sessionId}. Refusing to take payment.`,
      );
    }

    // Claim the session atomically: `assertOpen` above is only a read, and
    // two overlapping pay() calls used to create two orders and two stock
    // holds for one checkout. The loser gives back the order it just created.
    let paying: CheckoutSessionEntity;
    try {
      paying = await this.repo.updateOne(
        { id: { eq: sessionId }, status: { eq: "open" } },
        { ...totals, status: "paying", orderId: order.id },
      );
    } catch {
      await this.orders.cancel(order.id);
      throw new CommerceError(
        `Checkout ${sessionId} is no longer open: a payment is already in progress.`,
      );
    }

    let handoff: PaymentHandoff;
    try {
      handoff = await this.payment.start(paying, {
        returnUrl: options.returnUrl,
        email: session.email,
      });
    } catch (error) {
      // A PSP that refuses the handoff must not strand the session in
      // `paying` with a pending order: nothing reconciles that state (the
      // `commerce:checkout:paying` event is only emitted after the handoff)
      // and the buyer's retry was refused as "not open".
      await this.orders.cancel(order.id);
      await this.repo.updateById(sessionId, { status: "open" });
      throw error;
    }

    const updated = await this.repo.updateById(sessionId, {
      paymentIntentId: handoff.intentId,
    });

    // The buyer is now on the PSP page and may never come back — announce
    // it so the settlement module can schedule a reconciliation.
    await this.db.afterCommit(() =>
      this.alepha.events.emit(
        "commerce:checkout:paying",
        {
          sessionId,
          cartId: session.cartId,
          orderId: order.id,
          intentId: handoff.intentId,
        },
        { catch: true },
      ),
    );

    return { session: updated, handoff };
  }

  /**
   * Settle a checkout whose payment has been confirmed.
   *
   * Idempotent: a re-delivered webhook finds the session already `completed`
   * and returns it untouched. Fulfilment itself is idempotent one level down,
   * in {@link OrderService.markPaid}.
   */
  public async settle(
    sessionId: string,
    options: { paymentIntentId?: string } = {},
  ): Promise<CheckoutSessionEntity> {
    return this.db.transactional(async () => {
      const session = await this.repo.getById(sessionId);

      if (session.status === "completed") {
        return session;
      }
      if (!session.orderId) {
        throw new CommerceError(
          `Checkout ${sessionId} has no order to settle — pay() has not run.`,
        );
      }

      // Money for an order that is no longer taking it. The PSP intent
      // outlives the session, so a capture can land after the checkout was
      // abandoned - and settling it would mark an order paid whose stock has
      // already been released to other buyers.
      //
      // `paid` is NOT this case: that is a re-delivered webhook, and it must
      // still complete the session, which is what makes settle() idempotent.
      const order = await this.orders.getById(session.orderId);
      if (order.status === "cancelled" || order.status === "refunded") {
        await this.recordStrayCapture(order, options.paymentIntentId);
        return session;
      }

      await this.orders.markPaid(session.orderId, options);
      await this.carts.clear(session.cartId);

      return this.repo.updateById(sessionId, { status: "completed" });
    });
  }

  /**
   * Keep a capture that arrived too late, and say so.
   *
   * Deliberately does NOT refund: whether a stray capture is refunded, kept as
   * credit or escalated is a business decision this package cannot make. It
   * records and announces; the application decides.
   *
   * Appends rather than overwrites, because a retrying PSP can deliver more
   * than one.
   */
  protected async recordStrayCapture(
    order: { id: string; status: string; total: number; currency: string },
    paymentIntentId?: string,
  ): Promise<void> {
    this.log.warn(
      `Capture arrived for order ${order.id}, which is '${order.status}' - recording as a stray capture`,
      { orderId: order.id, paymentIntentId },
    );

    const existing = await this.orders.getById(order.id);
    const captures = Array.isArray(existing.strayCaptures)
      ? (existing.strayCaptures as Array<Record<string, any>>)
      : [];

    await this.orders.recordStrayCapture(order.id, [
      ...captures,
      {
        at: this.dateTime.nowISOString(),
        paymentIntentId,
        orderStatus: order.status,
        amount: order.total,
        currency: order.currency,
      },
    ]);

    await this.db.afterCommit(() =>
      this.alepha.events.emit(
        "commerce:capture:stray",
        {
          orderId: order.id,
          orderStatus: order.status,
          paymentIntentId,
          total: order.total,
          currency: order.currency,
        },
        { catch: true },
      ),
    );
  }

  /**
   * Find the checkout that a payment intent belongs to — the lookup a webhook
   * handler needs.
   */
  public async findByPaymentIntent(
    paymentIntentId: string,
  ): Promise<CheckoutSessionEntity | undefined> {
    return this.repo.findOne({
      where: { paymentIntentId: { eq: paymentIntentId } },
    });
  }

  /**
   * Everything a confirmation page shows: the order, its lines, and whatever
   * documents exist for it.
   *
   * @throws CommerceError when the checkout never reached payment
   */
  public async confirmation(sessionId: string): Promise<{
    order: Awaited<ReturnType<OrderService["getById"]>>;
    items: Awaited<ReturnType<OrderService["itemsOf"]>>;
    factures: string[];
  }> {
    const session = await this.repo.getById(sessionId);
    if (!session.orderId) {
      throw new CommerceError(
        `Checkout ${sessionId} has no order yet — pay() has not run.`,
      );
    }
    const order = await this.orders.getById(session.orderId);
    return {
      order,
      items: await this.orders.itemsOf(order.id),
      factures: await this.documents.documentsFor(order.id),
    };
  }

  /**
   * Refund the order behind a checkout and put its stock back.
   */
  public async refundOrder(orderId: string): Promise<void> {
    await this.orders.refund(orderId);
  }

  public async abandon(sessionId: string): Promise<CheckoutSessionEntity> {
    return this.repo.updateById(sessionId, { status: "abandoned" });
  }

  /**
   * Abandon a checkout *and* cancel the order it created, releasing its holds.
   *
   * Distinct from {@link abandon}, which only closes the session: a checkout that
   * reached `paying` has an order behind it, and leaving that order `pending`
   * would keep its stock held until the sweep noticed.
   *
   * Idempotent — a second failed-payment event finds the session already
   * abandoned.
   */
  public async abandonWithOrder(
    sessionId: string,
  ): Promise<CheckoutSessionEntity> {
    const abandoned = await this.db.transactional(async () => {
      const session = await this.repo.getById(sessionId);
      if (session.status === "abandoned" || session.status === "completed") {
        return { session, closed: false };
      }
      if (session.orderId) {
        await this.orders.cancel(session.orderId);
      }
      return {
        session: await this.repo.updateById(sessionId, {
          status: "abandoned",
        }),
        closed: true,
      };
    });

    // Close the payment too. The intent OUTLIVES this session: releasing the
    // stock and cancelling the order leaves the PSP page open in the buyer's
    // other tab, and a capture landing afterwards charges them for an order
    // that no longer exists.
    //
    // Outside the transaction, and failure is swallowed: an unreachable PSP
    // must not un-abandon a checkout, and a capture that gets through anyway
    // is caught by the stray-capture guard in `settle()`.
    if (abandoned.closed && abandoned.session.paymentIntentId) {
      try {
        await this.payment.abandon(abandoned.session.paymentIntentId);
      } catch (error) {
        this.log.warn(
          `Failed to close the payment for abandoned checkout ${sessionId}`,
          { error },
        );
      }
    }

    return abandoned.session;
  }

  public async getById(sessionId: string): Promise<CheckoutSessionEntity> {
    return this.repo.getById(sessionId);
  }

  /**
   * What the payment front-end can do — surfaced so a storefront renders the
   * right thing without hard-coding which PSP is installed.
   */
  public capabilities() {
    return this.payment.capabilities();
  }

  /**
   * Re-price a cart, keeping the cheapest available delivery option when a
   * destination is known.
   *
   * Cheapest rather than none: the figure shown before the buyer has picked a
   * method should be the one they will most likely pay, not an optimistic zero
   * that jumps when they choose.
   */
  protected async computeTotals(
    cartId: string,
    country?: string,
  ): Promise<CheckoutTotals> {
    const priced = await this.carts.price(cartId);
    if (!country) {
      return this.totalsOf(priced);
    }
    const quotes = await this.shipping.quote(country, priced.subtotal);
    return this.totalsOf(priced, quotes[0]);
  }

  /**
   * The single authoritative total, used by the on-screen preview *and* by order
   * creation. Two implementations of this arithmetic is how a customer ends up
   * charged a different figure from the one they were shown.
   *
   * Prices are tax-inclusive (the legal requirement for B2C display in the EU),
   * so `grandTotal` is subtotal + delivery, and `taxTotal` is what that already
   * contains. Adding it on top would double-charge the VAT.
   */
  protected totalsOf(
    priced: Awaited<ReturnType<CartService["price"]>>,
    shippingQuote?: CheckoutShippingQuote,
  ): CheckoutTotals {
    const shippingTotal = shippingQuote?.price ?? 0;
    const tax = this.tax.compute(priced, shippingTotal);
    return {
      subtotal: priced.subtotal,
      shippingTotal,
      taxTotal: tax.total,
      grandTotal: priced.subtotal + shippingTotal,
      currency: priced.currency,
    };
  }

  /**
   * The destination country recorded on a session, if any.
   */
  protected countryOf(session: CheckoutSessionEntity): string | undefined {
    return (session.shippingAddress as { country?: string } | undefined)
      ?.country;
  }

  protected assertOpen(session: CheckoutSessionEntity): void {
    if (session.status !== "open") {
      throw new CommerceError(
        `Checkout ${session.id} is '${session.status}', not 'open'.`,
      );
    }
  }
}
