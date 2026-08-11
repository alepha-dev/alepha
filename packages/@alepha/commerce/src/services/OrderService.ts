import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, DatabaseProvider, type Page } from "alepha/orm";
import { type OrderItemEntity, orderItems } from "../entities/orderItems.ts";
import {
  type OrderEntity,
  type OrderStatus,
  orders,
} from "../entities/orders.ts";
import { products } from "../entities/products.ts";
import { CommerceError } from "../errors/CommerceError.ts";
import { ProductKindRegistry } from "../providers/ProductKindRegistry.ts";
import { StockService } from "./StockService.ts";

export interface OrderLineInput {
  productId: string;
  quantity: number;
}

export interface CreateOrderInput {
  userId?: string;
  lines: OrderLineInput[];
  status?: OrderStatus;
  paymentIntentId?: string;
  shippingMethod?: string;
  shippingAddress?: Record<string, any>;
  /**
   * Delivery charged. Added to the line-item sum to form `orders.total`, which
   * is what the customer pays — see the note on that column.
   */
  shippingTotal?: number;
  /** VAT contained in the total. Computed by the caller, which knows the rate. */
  taxTotal?: number;
  notes?: string;
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
  protected readonly dateTime = $inject(DateTimeProvider);

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
    const currency = byId.get(productIds[0]!)!.currency;
    const shippingTotal = input.shippingTotal ?? 0;
    let itemsTotal = 0;
    for (const line of input.lines) {
      itemsTotal += byId.get(line.productId)!.price * line.quantity;
    }

    return this.db.transactional(async () => {
      const order = await this.orderRepo.create({
        userId: input.userId,
        status,
        // Items + delivery: this is the figure the card is charged.
        total: itemsTotal + shippingTotal,
        shippingTotal,
        taxTotal: input.taxTotal ?? 0,
        currency,
        paymentIntentId: input.paymentIntentId,
        shippingMethod: input.shippingMethod,
        shippingAddress: input.shippingAddress,
        notes: input.notes,
      });

      const items = await this.itemRepo.createMany(
        input.lines.map((line) => {
          const product = byId.get(line.productId)!;
          return {
            orderId: order.id,
            productId: product.id,
            kind: product.kind,
            name: product.name,
            unitPrice: product.price,
            rateBps: product.vatRateBps,
            quantity: line.quantity,
            config: product.config,
          };
        }),
      );

      if (status === "paid") {
        // A counter sale: the money is already in, so skip the hold and go
        // straight to fulfilment.
        await this.fulfilAll(items);
      } else {
        // An online order: hold what it consumes until the payment settles.
        await this.reserveAll(items);
      }

      return order;
    });
  }

  /**
   * Settle a pending order: flip it to `paid` and fulfil its lines.
   *
   * Idempotent on the order's status — a re-delivered payment webhook finds the
   * order already `paid` and does nothing, rather than fulfilling twice.
   */
  public async markPaid(
    id: string,
    options: { paymentIntentId?: string } = {},
  ): Promise<OrderEntity> {
    const { order, settled } = await this.db.transactional(async () => {
      const current = await this.orderRepo.getById(id);
      if (current.status !== "pending") {
        this.log.debug("Order already settled, skipping fulfilment", {
          orderId: id,
          status: current.status,
        });
        return { order: current, settled: false };
      }

      const items = await this.itemRepo.findMany({
        where: { orderId: { eq: id } },
      });
      await this.fulfilAll(items);

      return {
        order: await this.orderRepo.updateById(id, {
          status: "paid",
          ...(options.paymentIntentId
            ? { paymentIntentId: options.paymentIntentId }
            : {}),
        }),
        settled: true,
      };
    });

    // Outside the transaction, and only on the transition: a subscriber reads a
    // committed order, and a redelivered webhook emits nothing the second time —
    // which is what stops a second invoice being issued for one sale.
    if (settled) {
      await this.alepha.events.emit("commerce:order:paid", {
        orderId: order.id,
        total: order.total,
        currency: order.currency,
        userId: order.userId,
      });
    }

    return order;
  }

  /**
   * Cancel an unpaid order, giving back whatever it was holding.
   */
  public async cancel(id: string): Promise<OrderEntity> {
    const order = await this.db.transactional(async () => {
      await this.stock.releaseFor(id);
      return this.orderRepo.updateById(id, { status: "cancelled" });
    });

    await this.alepha.events.emit("commerce:order:cancelled", {
      orderId: order.id,
    });
    return order;
  }

  /**
   * Refund a paid order and put its stock back.
   */
  public async refund(id: string): Promise<OrderEntity> {
    const { order, changed } = await this.db.transactional(async () => {
      const current = await this.orderRepo.getById(id);
      if (current.status === "refunded") {
        return { order: current, changed: false };
      }
      await this.stock.releaseOrder(id);
      return {
        order: await this.orderRepo.updateById(id, { status: "refunded" }),
        changed: true,
      };
    });

    if (changed) {
      await this.alepha.events.emit("commerce:order:refunded", {
        orderId: order.id,
        total: order.total,
        currency: order.currency,
      });
    }
    return order;
  }

  /**
   * Mark items prepared. Optional step — a shop that packs and posts in one go
   * can move straight from `paid` to `shipped`.
   */
  public async markFulfilled(id: string): Promise<OrderEntity> {
    await this.assertTransition(id, ["paid"], "fulfilled");
    return this.orderRepo.updateById(id, { status: "fulfilled" });
  }

  /**
   * Hand the order to a carrier.
   *
   * Guarded: only a paid or prepared order can ship. Without the guard an admin
   * double-click could ship a refunded order, and the buyer would get a tracking
   * email for a parcel nobody sent — the class of unguarded status transition
   * this codebase has been bitten by before.
   */
  public async markShipped(
    id: string,
    options: { trackingNumber?: string; trackingUrl?: string } = {},
  ): Promise<OrderEntity> {
    await this.assertTransition(id, ["paid", "fulfilled"], "shipped");

    const order = await this.orderRepo.updateById(id, {
      status: "shipped",
      shippedAt: this.dateTime.nowISOString(),
      ...(options.trackingNumber
        ? { trackingNumber: options.trackingNumber }
        : {}),
      ...(options.trackingUrl ? { trackingUrl: options.trackingUrl } : {}),
    });

    await this.alepha.events.emit("commerce:order:shipped", {
      orderId: order.id,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
    });

    return order;
  }

  public async markDelivered(id: string): Promise<OrderEntity> {
    await this.assertTransition(id, ["shipped"], "delivered");
    return this.orderRepo.updateById(id, {
      status: "delivered",
      deliveredAt: this.dateTime.nowISOString(),
    });
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
    query: { size?: number; page?: number; status?: OrderStatus } = {},
  ): Promise<Page<OrderEntity>> {
    const where = this.orderRepo.createQueryWhere();
    // Omitted rather than set to undefined: a `where` value of `undefined`
    // throws rather than being ignored.
    if (query.status) {
      where.status = { eq: query.status };
    }
    return this.orderRepo.paginate(
      { sort: "-createdAt", ...query },
      { where },
      { count: true },
    );
  }

  /**
   * Refuse a status change that does not come from an expected state.
   */
  protected async assertTransition(
    id: string,
    from: OrderStatus[],
    to: OrderStatus,
  ): Promise<OrderEntity> {
    const order = await this.orderRepo.getById(id);
    if (!from.includes(order.status)) {
      throw new CommerceError(
        `Cannot move order ${id} to '${to}': it is '${order.status}', expected one of ${from.join(", ")}.`,
      );
    }
    return order;
  }

  public async itemsOf(orderId: string): Promise<OrderItemEntity[]> {
    return this.itemRepo.findMany({ where: { orderId: { eq: orderId } } });
  }

  /**
   * Hand each line to the handler that owns its kind.
   *
   * Sequential on purpose: two lines of the same product must not race each
   * other on the stock ledger.
   */
  protected async fulfilAll(items: OrderItemEntity[]): Promise<void> {
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
    for (const item of items) {
      await this.kinds.get(item.kind).reserve?.(item);
    }
  }
}
