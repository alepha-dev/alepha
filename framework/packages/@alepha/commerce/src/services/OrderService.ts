import { $inject, $store, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  $repository,
  $sequence,
  DatabaseProvider,
  DbEntityNotFoundError,
  type Page,
} from "alepha/orm";

import { type OrderItemEntity, orderItems } from "../entities/orderItems.ts";
import {
  type OrderEntity,
  type OrderStatus,
  orders,
} from "../entities/orders.ts";
import { products } from "../entities/products.ts";
import type { ProductVariantEntity } from "../entities/productVariants.ts";
import { CommerceError } from "../errors/CommerceError.ts";
import { orderConfig } from "../orderConfigAtom.ts";
import { ProductKindRegistry } from "../providers/ProductKindRegistry.ts";
import { ClaimLock } from "./ClaimLock.ts";
import { LineConfigService } from "./LineConfigService.ts";
import { ResourceService } from "./ResourceService.ts";
import { StockService } from "./StockService.ts";
import { VariantService } from "./VariantService.ts";

export interface OrderLineInput {
  productId: string;
  quantity: number;
  /**
   * The variant sold, required on a product sold by variant. Checked here too:
   * the cart is not the only way an order gets created.
   */
  variantId?: string;
  /**
   * This line's share of a discount, tax included: the order takes
   * `unitPrice * quantity - discount` for it. The caller computed it and is
   * trusted to: a line config comes from a buyer, a discount never does.
   */
  discount?: number;
  /**
   * What the line chooses beyond the product, for a kind that takes it (a
   * court and an interval). Validated again by the kind's handler before the
   * order is written, whatever validated it before: without that, a client
   * could book any resource for any interval at the product's price.
   */
  lineConfig?: Record<string, any>;
}

export interface CreateOrderInput {
  userId?: string;
  lines: OrderLineInput[];
  status?: OrderStatus;
  paymentIntentId?: string;
  shippingMethod?: string;
  shippingAddress?: Record<string, any>;
  /**
   * The code behind the lines' discounts, frozen on the order.
   */
  promotionCode?: string;
  /**
   * Delivery charged. Added to the line-item sum to form `orders.total`, which
   * is what the customer pays — see the note on that column.
   */
  shippingTotal?: number;
  /**
   * VAT contained in the total. Computed by the caller, which knows the rate.
   */
  taxTotal?: number;
  notes?: string;
}

/**
 * An order line with the few facts about its parent order that make it
 * readable on its own — which is how the catalogue shows a product's sales.
 *
 * The order fields are optional because the parent lookup is a separate query:
 * an order deleted between the two would otherwise take the whole page down,
 * and a line whose order has gone is still a true record of a sale.
 */
export interface ProductOrderLine extends OrderItemEntity {
  orderNumber?: string;
  orderStatus?: OrderStatus;
  orderCreatedAt?: string;
  orderCurrency?: string;
}

/**
 * Creates orders and drives their status.
 *
 * Two entry points, matching the two ways money arrives:
 *
 * - {@link create} with `status: "pending"` — an online checkout, settled later
 *   by {@link markPaid} when the payment webhook lands.
 * - {@link create} with `status: "paid"` — a counter sale, where the money is
 *   already in the till.
 *
 * Fulfilment (what a paid line *does*) is delegated to the handler registered
 * for the line's kind, so this service never learns what a wallet top-up or a
 * seat reservation is.
 */
export class OrderService {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly db = $inject(DatabaseProvider);
  protected readonly orderRepo = $repository(orders);
  protected readonly itemRepo = $repository(orderItems);
  protected readonly productRepo = $repository(products);
  protected readonly kinds = $inject(ProductKindRegistry);
  protected readonly stock = $inject(StockService);
  protected readonly resources = $inject(ResourceService);
  protected readonly lines = $inject(LineConfigService);
  protected readonly variants = $inject(VariantService);
  protected readonly lock = $inject(ClaimLock);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly config = $store(orderConfig);

  /**
   * One counter per year, so a number stays short.
   */
  protected readonly orderNumber = $sequence({ name: "commerce_order" });

  /**
   * Create an order, snapshotting each line from its product.
   *
   * When the order is created already `paid`, fulfilment runs inside the same
   * transaction — so a handler that throws (out of stock, say) rolls the order
   * back rather than leaving a paid order half-delivered.
   */
  public async create(input: CreateOrderInput): Promise<OrderEntity> {
    if (input.lines.length === 0) {
      throw new CommerceError("Cannot create an order with no lines.");
    }

    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const found = await this.productRepo.findMany({
      where: { id: { inArray: productIds } },
    });
    const byId = new Map(found.map((p) => [p.id, p]));

    // Resolve every kind up-front: an unregistered kind must fail before we
    // open a transaction, not halfway through fulfilment.
    for (const id of productIds) {
      const product = byId.get(id);
      if (!product) {
        throw new CommerceError(`Unknown product: ${id}`);
      }
      this.kinds.get(product.kind);
    }

    const status = input.status ?? "pending";

    /*
     * One currency per order, enforced rather than assumed.
     *
     * `total` below is a plain sum of `price * quantity` across the lines, and
     * the order carries a single `currency`. Taking the first product's
     * currency and summing the rest into it — which is what this did — charges
     * a cart of a €89 ring and a $120 pendant as 209 EUR. Nothing anywhere
     * would have reported it: the order looks internally consistent, and the
     * payment intent is created from the same wrong figure.
     *
     * It was unreachable through the back office while nothing could set
     * `currency`, and reachable through the API the whole time. Multi-currency
     * pricing is a real feature, but it needs conversion at checkout, not a
     * silent reinterpretation of the number.
     */
    const currency = byId.get(productIds[0]!)!.currency;
    const foreign = productIds.find(
      (id) => byId.get(id)!.currency !== currency,
    );
    if (foreign) {
      throw new CommerceError(
        `Cannot create an order mixing currencies: product ${foreign} is priced in ${
          byId.get(foreign)!.currency
        }, the order is in ${currency}. Split it into one order per currency.`,
      );
    }

    // Each line judged by its kind and priced on the server, before the
    // transaction opens: the same two calls `CartService.price` made, so the
    // order charges what the cart showed.
    const allVariants = await this.variants.listForProducts(productIds);
    const accepted: Array<{
      lineConfig: Record<string, any> | undefined;
      unitPrice: number;
      variant: ProductVariantEntity | undefined;
    }> = [];
    for (const line of input.lines) {
      const product = byId.get(line.productId)!;
      const variant = this.variants.pick(
        product,
        allVariants.filter((it) => it.productId === product.id),
        line.variantId,
      );
      const lineConfig = await this.lines.accept(
        product,
        line.lineConfig,
        line.quantity,
      );
      accepted.push({
        lineConfig,
        unitPrice: await this.lines.unitPrice(product, lineConfig, variant),
        variant,
      });
    }

    const shippingTotal = input.shippingTotal ?? 0;
    let itemsTotal = 0;
    let discountTotal = 0;
    for (const [index, line] of input.lines.entries()) {
      itemsTotal += accepted[index]!.unitPrice * line.quantity;
      discountTotal += line.discount ?? 0;
    }

    // Taken before the transaction, unlike an invoice's: inside it the counter's
    // row stays locked until COMMIT, and every checkout would wait for the one
    // ahead of it. An order that then fails burns its number, which is fine
    // for a reference.
    const number = await this.nextNumber();

    return this.db.transactional(async () => {
      const order = await this.orderRepo.create({
        number,
        userId: input.userId,
        status,
        // Items + delivery: this is the figure the card is charged.
        total: itemsTotal - discountTotal + shippingTotal,
        discountTotal,
        promotionCode: input.promotionCode,
        shippingTotal,
        taxTotal: input.taxTotal ?? 0,
        currency,
        paymentIntentId: input.paymentIntentId,
        shippingMethod: input.shippingMethod,
        shippingAddress: input.shippingAddress,
        notes: input.notes,
      });

      const items = await this.itemRepo.createMany(
        input.lines.map((line, index) => {
          const product = byId.get(line.productId)!;
          const variant = accepted[index]!.variant;
          return {
            orderId: order.id,
            productId: product.id,
            variantId: variant?.id,
            kind: product.kind,
            name: product.name,
            sku: variant?.sku,
            variantLabel: variant && this.variants.label(product, variant),
            unitPrice: accepted[index]!.unitPrice,
            discount: line.discount ?? 0,
            rateBps: product.vatRateBps,
            quantity: line.quantity,
            config: product.config,
            lineConfig: accepted[index]!.lineConfig,
          };
        }),
      );

      try {
        if (status === "paid") {
          // A counter sale: the money is already in, so skip the hold and go
          // straight to fulfilment.
          await this.fulfilAll(items);
        } else {
          // An online order: hold what it consumes until the payment settles.
          await this.reserveAll(items);
        }
      } catch (error) {
        await this.undoWithoutTransaction(order.id);
        throw error;
      }

      return order;
    });
  }

  /**
   * Keep a capture that arrived for an order no longer taking money.
   *
   * A plain write, deliberately: the order's STATUS does not move. Money that
   * arrived too late is a fact to record and act on, not a reason to sell
   * stock that has already been released to somebody else.
   *
   * @see CheckoutService.settle
   */
  public async recordStrayCapture(
    id: string,
    captures: Array<Record<string, any>>,
  ): Promise<OrderEntity> {
    return this.orderRepo.updateById(id, { strayCaptures: captures });
  }

  /**
   * Settle a pending order: flip it to `paid` and fulfil its lines.
   *
   * Idempotent on the order's status, and safe under concurrency: the status
   * moves first, by a conditional update, so of two settles that overlap one
   * moves it and the other finds nothing to move and does nothing. A check
   * made before fulfilling could not say that: both would read `pending`, and
   * the second would sell the stock again once the first let go of the lock.
   *
   * Returns the order as it stands, which is not `paid` when somebody else
   * moved it first: cancelled, say. The caller reads the status.
   */
  public async markPaid(
    id: string,
    options: { paymentIntentId?: string } = {},
  ): Promise<OrderEntity> {
    return this.db.transactional(async () => {
      const order = await this.claim(id, ["pending"], {
        status: "paid",
        ...(options.paymentIntentId
          ? { paymentIntentId: options.paymentIntentId }
          : {}),
      });
      if (!order) {
        const current = await this.orderRepo.getById(id);
        this.log.debug("Order already settled, skipping fulfilment", {
          orderId: id,
          status: current.status,
        });
        return current;
      }

      const items = await this.itemRepo.findMany({
        where: { orderId: { eq: id } },
      });
      try {
        await this.fulfilAll(items);
      } catch (error) {
        // Where there is no transaction, the lines fulfilled before the one
        // that threw stay sold, and the status stays moved. The order is not
        // paid, so both come back.
        await this.undoWithoutTransaction(id, { status: "pending" });
        throw error;
      }

      // Only on the transition — a redelivered webhook returns above and emits
      // nothing, which is what stops a second invoice for one sale. Deferred
      // via afterCommit, not placed after this block: this block may be
      // JOINING a caller's transaction (the webhook path — CheckoutService's
      // settle() wraps markPaid), and "after markPaid's block" would still be
      // inside that outer transaction, handing subscribers uncommitted rows
      // and holding row locks on orders and stock while they issue invoices
      // and talk to an SMTP server.
      await this.db.afterCommit(() =>
        this.alepha.events.emit("commerce:order:paid", {
          orderId: order.id,
          total: order.total,
          currency: order.currency,
          userId: order.userId,
        }),
      );

      return order;
    });
  }

  /**
   * Cancel an unpaid order, giving back whatever it was holding: its stock
   * holds and its interval holds, at once rather than when the sweep runs.
   *
   * The release is all this package does. Cancellation policy (a fee, a
   * free-cancel window, a weather rule, how close to the slot's start the
   * cancellation came) is the application's, built on this release. So is
   * cancelling one line of a multi-line order: there is no item-level
   * cancellation here, and if one is needed it is an `OrderService.cancelItems`
   * releasing by `orderItemId`, which the claims already carry.
   */
  public async cancel(id: string): Promise<OrderEntity> {
    return this.db.transactional(async () => {
      // A paid order is not cancelled, it is refunded: cancelling one used
      // to release units that were sold and leave the money taken.
      const order = await this.transition(id, ["pending"], {
        status: "cancelled",
      });
      await this.stock.releaseFor(id);
      await this.resources.releaseFor(id);

      // Deferred for the same reason as in markPaid: cancel() is reached from
      // inside abandonWithOrder()'s transaction on payments:failed.
      await this.db.afterCommit(() =>
        this.alepha.events.emit("commerce:order:cancelled", {
          orderId: order.id,
        }),
      );

      return order;
    });
  }

  /**
   * Record what has been given back on a paid order.
   *
   * `refundedTotal` is a TOTAL, not a delta: the amount the payment rail says
   * has come back on this order altogether, including refunds recorded before
   * this call. Omit it and the whole order is refunded, which is what the
   * admin's own "Refund" action means and what every caller meant before
   * partial refunds existed.
   *
   * Writing a total rather than adding a delta is what makes this idempotent.
   * `payments:refunded` is delivered at least once, and an accumulator would
   * turn a redelivered event into a second refund on paper; the payment rail
   * already keeps the per-intent ledger, so its sum is the authority and this
   * only mirrors it.
   *
   * The order reaches `refunded` only when that total covers `total`. Anything
   * short of it is `partially_refunded` - a ten percent goodwill gesture used
   * to read, in the back office and in the customer's history, exactly like a
   * sale that had been undone.
   */
  public async refund(
    id: string,
    options: { refundedTotal?: number } = {},
  ): Promise<OrderEntity> {
    return this.db.transactional(async () => {
      const current = await this.orderRepo.getById(id);
      if (current.status === "refunded") {
        return current;
      }

      // Capped at the order: a rail that reports more than was charged (a
      // rounding difference, a manual over-refund) must not leave a negative
      // remainder behind.
      const refundedTotal = Math.min(
        options.refundedTotal ?? current.total,
        current.total,
      );
      if (refundedTotal <= current.refundedTotal) {
        // Nothing new - a redelivered event, or a refund already recorded.
        return current;
      }
      const full = refundedTotal >= current.total;
      const to = full ? "refunded" : "partially_refunded";

      // Only money that moved can come back: a pending order has nothing to
      // refund, and flipping it hid that no payment ever happened. A partially
      // refunded order can be refunded again, up to the rest.
      const from: OrderStatus[] = [
        "paid",
        "fulfilled",
        "shipped",
        "delivered",
        "partially_refunded",
      ];
      if (!from.includes(current.status)) {
        throw this.refusedTransition(current, from, to);
      }

      // Conditional on what was read, the refunded total included: an admin
      // refund racing the rail's own webhook moves the order once. The loser
      // decides again on what the winner wrote, which is usually nothing left
      // to do.
      let order: OrderEntity;
      try {
        order = await this.orderRepo.updateOne(
          {
            id: { eq: id },
            status: { eq: current.status },
            refundedTotal: { eq: current.refundedTotal },
          },
          { status: to, refundedTotal },
        );
      } catch (error) {
        if (error instanceof DbEntityNotFoundError) {
          return this.refund(id, options);
        }
        throw error;
      }

      // Stock comes back only when the sale is undone. A partial refund is a
      // price adjustment on goods the customer keeps, so releasing units here
      // would put things back on the shelf that never returned.
      // The same for intervals: a full refund gives the court back, a partial
      // one leaves it booked.
      //
      // And only while the goods are still here. Once shipped they are with
      // the customer or lost in transit, and restocking them sells units the
      // shop does not have: a return records what actually came back. Read off
      // `shippedAt`, because the status can hide it: a shipped order partially
      // refunded reads `partially_refunded`.
      if (full) {
        if (!current.shippedAt) {
          await this.stock.releaseOrder(id);
        }
        await this.resources.releaseOrder(id);
      }

      // Only on the transition, and deferred for the same reason as in
      // markPaid — nothing stops a caller from wrapping refund() in a
      // transaction of its own.
      await this.db.afterCommit(() =>
        this.alepha.events.emit("commerce:order:refunded", {
          orderId: order.id,
          total: order.total,
          amount: refundedTotal - current.refundedTotal,
          refundedTotal,
          currency: order.currency,
        }),
      );

      return order;
    });
  }

  /**
   * Mark items prepared. Optional step — a shop that packs and posts in one go
   * can move straight from `paid` to `shipped`.
   */
  /**
   * @public No caller in this package, and there should not be one: when an
   * order is fulfilled is a question only the application can answer. Covered
   * by `orderLifecycle.spec.ts` and `partialRefund.spec.ts`.
   */
  public async markFulfilled(id: string): Promise<OrderEntity> {
    // `partially_refunded` too: a goodwill refund is a price adjustment, and
    // the parcel it applies to still has to be packed.
    return this.db.transactional(() =>
      this.transition(id, ["paid", "partially_refunded"], {
        status: "fulfilled",
      }),
    );
  }

  /**
   * Hand the order to a carrier.
   *
   * Guarded: only a paid or prepared order can ship. Without the guard an admin
   * double-click could ship a refunded order, and the buyer would get a tracking
   * email for a parcel nobody sent — the class of unguarded status transition
   * this codebase has been bitten by before. Conditional as well as guarded: of
   * two clicks that overlap, one ships and the other is refused, so the
   * shipping email goes out once.
   */
  public async markShipped(
    id: string,
    options: { trackingNumber?: string; trackingUrl?: string } = {},
  ): Promise<OrderEntity> {
    return this.db.transactional(async () => {
      const order = await this.transition(
        id,
        ["paid", "fulfilled", "partially_refunded"],
        {
          status: "shipped",
          shippedAt: this.dateTime.nowISOString(),
          ...(options.trackingNumber
            ? { trackingNumber: options.trackingNumber }
            : {}),
          ...(options.trackingUrl ? { trackingUrl: options.trackingUrl } : {}),
        },
      );

      await this.db.afterCommit(() =>
        this.alepha.events.emit("commerce:order:shipped", {
          orderId: order.id,
          trackingNumber: order.trackingNumber,
          trackingUrl: order.trackingUrl,
        }),
      );

      return order;
    });
  }

  public async markDelivered(id: string): Promise<OrderEntity> {
    return this.db.transactional(() =>
      this.transition(id, ["shipped"], {
        status: "delivered",
        deliveredAt: this.dateTime.nowISOString(),
      }),
    );
  }

  public async getById(id: string): Promise<OrderEntity> {
    return this.orderRepo.getById(id);
  }

  /**
   * A customer's own orders, most recent first.
   */
  public async listForUser(
    userId: string,
    query: { size?: number; page?: number } = {},
  ): Promise<Page<OrderEntity>> {
    return this.orderRepo.paginate(
      { sort: "-createdAt", ...query },
      { where: { userId: { eq: userId } } },
      { count: true },
    );
  }

  /**
   * Back-office listing, filterable by status.
   */
  public async list(
    query: {
      size?: number;
      page?: number;
      status?: OrderStatus;
      /**
       * A piece of the order number.
       */
      q?: string;
    } = {},
  ): Promise<Page<OrderEntity>> {
    const where = this.orderRepo.createQueryWhere();
    // Omitted rather than set to undefined: a `where` value of `undefined`
    // throws rather than being ignored.
    if (query.status) {
      where.status = { eq: query.status };
    }
    if (query.q) {
      where.number = { contains: query.q };
    }
    return this.orderRepo.paginate(
      { sort: "-createdAt", ...query },
      { where },
      { count: true },
    );
  }

  /**
   * Give back what a failed create or settlement took, on a database that has
   * no transaction to roll it back.
   *
   * D1 and PGlite run `transactional()` in place, so when line 3's claim
   * throws, lines 1 and 2 keep their holds (and, for a counter sale, their
   * sales) until somebody notices: half an hour of a court nobody can book.
   * Where there IS a transaction nothing is written here: the rollback
   * already undoes it all, and a write into a transaction that a failed
   * statement aborted would only replace the real error with its own.
   *
   * `restore` is what the failed step wrote on the order itself.
   */
  protected async undoWithoutTransaction(
    orderId: string,
    restore?: { status: OrderStatus },
  ): Promise<void> {
    if (this.db.supportsTransactions) {
      return;
    }
    try {
      await this.stock.releaseOrder(orderId);
      await this.resources.releaseOrder(orderId);
      if (restore) {
        await this.orderRepo.updateById(orderId, restore);
      }
    } catch (cleanup) {
      // The error being rethrown is the one the caller needs; this one only
      // means the sweep will tidy up instead.
      this.log.error("Could not release a failed order's holds", {
        orderId,
        error: cleanup,
      });
    }
  }

  /**
   * `CMD-2026-000123`. Zero-padded so a plain text sort matches creation
   * order, like an invoice number.
   */
  protected async nextNumber(): Promise<string> {
    const year = this.dateTime.now().format("YYYY");
    const sequence = await this.orderNumber.next(year);
    return `${this.config.numberPrefix}-${year}-${String(sequence).padStart(6, "0")}`;
  }

  /**
   * Move an order out of one of `from`, on the database's word rather than on
   * a value read earlier, and answer `undefined` when it was in none of them.
   *
   * This is what every transition goes through. A check followed by a write
   * lets two callers pass the check on the same read: the conditional update
   * cannot, because the row is what decides. On Postgres the second update
   * waits for the first to commit, then matches nothing; a database with no
   * transaction runs one after the other and gets the same answer. So it
   * needs no `FOR UPDATE`, which SQLite and D1 do not have.
   *
   * Comes before any side effect: whoever moved the order is the one caller
   * that fulfils it, or releases its stock.
   */
  protected async claim(
    id: string,
    from: OrderStatus[],
    patch: Partial<OrderEntity> & { status: OrderStatus },
  ): Promise<OrderEntity | undefined> {
    try {
      return await this.orderRepo.updateOne(
        { id: { eq: id }, status: { inArray: from } },
        patch,
      );
    } catch (error) {
      if (error instanceof DbEntityNotFoundError) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * {@link claim}, refusing a status change that does not come from an
   * expected state.
   */
  protected async transition(
    id: string,
    from: OrderStatus[],
    patch: Partial<OrderEntity> & { status: OrderStatus },
  ): Promise<OrderEntity> {
    const order = await this.claim(id, from, patch);
    if (!order) {
      throw this.refusedTransition(
        await this.orderRepo.getById(id),
        from,
        patch.status,
      );
    }
    return order;
  }

  protected refusedTransition(
    order: OrderEntity,
    from: OrderStatus[],
    to: OrderStatus,
  ): CommerceError {
    return new CommerceError(
      `Cannot move order ${order.id} to '${to}': it is '${order.status}', expected one of ${from.join(", ")}.`,
    );
  }

  public async itemsOf(orderId: string): Promise<OrderItemEntity[]> {
    return this.itemRepo.findMany({ where: { orderId: { eq: orderId } } });
  }

  /**
   * Every order line that sold a given product, newest first, each carrying the
   * date and status of the order it belongs to.
   *
   * The catalogue's answer to "has this ever sold, and to what effect" — which
   * is a question about lines, not orders: one order may contain the product
   * twice at different prices, and rolling those into a single order row would
   * hide exactly the detail being asked for. The line's own snapshotted
   * `unitPrice` is what it sold for, not today's catalogue price.
   *
   * Two queries rather than a join: `orderItems.orderId` is a `db.ref`, but the
   * page is at most `size` rows, so the second lookup is one `inArray` over a
   * handful of ids and keeps this readable across both SQL dialects the package
   * supports.
   */
  public async linesOfProduct(
    productId: string,
    query: { size?: number; page?: number } = {},
  ): Promise<Page<ProductOrderLine>> {
    const page = await this.itemRepo.paginate(
      { sort: "-createdAt", ...query },
      { where: { productId: { eq: productId } } },
      { count: true },
    );

    if (page.content.length === 0) {
      return { ...page, content: [] };
    }

    const parents = await this.orderRepo.findMany({
      where: { id: { inArray: page.content.map((item) => item.orderId) } },
    });
    const byId = new Map(parents.map((order) => [order.id, order]));

    return {
      ...page,
      content: page.content.map((item) => {
        const order = byId.get(item.orderId);
        return {
          ...item,
          orderNumber: order?.number,
          orderStatus: order?.status,
          orderCreatedAt: order?.createdAt,
          orderCurrency: order?.currency,
        };
      }),
    };
  }

  /**
   * Hand each line to the handler that owns its kind.
   *
   * Sequential on purpose: two lines of the same product must not race each
   * other on the stock ledger. After {@link lockAll}, for the reason given
   * there.
   */
  protected async fulfilAll(items: OrderItemEntity[]): Promise<void> {
    await this.lockAll(items);
    for (const item of items) {
      await this.kinds.get(item.kind).fulfil(item);
    }
  }

  /**
   * Ask each handler to hold what its line consumes. A handler with nothing to
   * hold — a download, a gift card — simply does not implement `reserve`.
   *
   * A throw here (nothing left in stock) aborts the order's transaction, which
   * is the behaviour we want: better to refuse at the checkout than to take
   * money for a ring that has just been sold.
   */
  protected async reserveAll(items: OrderItemEntity[]): Promise<void> {
    await this.lockAll(items);
    for (const item of items) {
      await this.kinds.get(item.kind).reserve?.(item);
    }
  }

  /**
   * Take every claim lock the order's lines need, up front and in one global
   * order, before any handler claims anything.
   *
   * On Postgres every claim holds its lock until the order's transaction
   * commits. Two orders taking the same locks in different orders (court 2
   * then court 1 against court 1 then court 2, a stock line against a
   * resource line, the two legs of a seat listed backwards) would each hold
   * one lock and wait on the other, and Postgres would break that deadlock by
   * failing one of the checkouts. Sorted by `(namespace, key)` across the
   * whole order, the second order waits for the first instead. Walking the
   * lines by product id, as this used to, only ordered stock: one product
   * sells many resources.
   *
   * The handlers' own claims then take locks this transaction already holds,
   * which Postgres grants at once. Elsewhere there are no locks to take, and
   * this does nothing.
   */
  protected async lockAll(items: OrderItemEntity[]): Promise<void> {
    await this.lock.acquire(
      items.flatMap((item) => this.kinds.get(item.kind).lockKeys?.(item) ?? []),
    );
  }
}
