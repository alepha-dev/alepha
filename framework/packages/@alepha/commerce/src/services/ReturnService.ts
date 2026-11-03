import { $inject, $store, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import {
  $repository,
  DatabaseProvider,
  DbEntityNotFoundError,
  type Page,
} from "alepha/orm";

import type { RefundLine } from "../entities/orderRefunds.ts";
import {
  type OrderReturnEntity,
  type OrderReturnStatus,
  orderReturns,
} from "../entities/orderReturns.ts";
import { InvalidReturnError } from "../errors/CommerceError.ts";
import { orderConfig } from "../orderConfigAtom.ts";
import { OrderService } from "./OrderService.ts";

/**
 * Returns: a request, a parcel, a refund or a refusal.
 *
 * The withdrawal right runs from when the customer got the goods, and it is the
 * only condition a customer is held to here: anything past it is a conversation,
 * which the shop can have by creating the return itself.
 */
export class ReturnService {
  protected readonly alepha = $inject(Alepha);
  protected readonly db = $inject(DatabaseProvider);
  protected readonly repo = $repository(orderReturns);
  protected readonly orders = $inject(OrderService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly config = $store(orderConfig);

  /**
   * Record a customer's request.
   *
   * @throws InvalidReturnError outside the withdrawal period, on an order that
   *   has not shipped, or for units it has no more of
   */
  public async request(
    orderId: string,
    input: { lines: RefundLine[]; reason?: string },
  ): Promise<OrderReturnEntity> {
    const order = await this.orders.getById(orderId);

    const received = order.deliveredAt ?? order.shippedAt;
    if (!received) {
      throw new InvalidReturnError(
        `Order ${orderId} has not shipped: cancel its lines instead.`,
      );
    }
    const deadline =
      new Date(received).getTime() +
      this.config.withdrawalDays * 24 * 60 * 60 * 1000;
    if (this.dateTime.nowMillis() > deadline) {
      throw new InvalidReturnError(
        `The withdrawal period of order ${orderId} is over.`,
      );
    }

    await this.assertReturnable(orderId, input.lines);

    const created = await this.repo.create({
      orderId,
      lines: input.lines,
      reason: input.reason,
      status: "requested",
    });

    await this.db.afterCommit(() =>
      this.alepha.events.emit(
        "commerce:return:requested",
        { returnId: created.id, orderId },
        { catch: true },
      ),
    );

    return created;
  }

  /**
   * The parcel is here. `restock` is what can be sold again, all of it unless
   * told otherwise: only somebody who opened it knows.
   *
   * A conditional move, so a double click restocks once.
   *
   * @throws InvalidReturnError when it is not awaiting a parcel
   */
  public async receive(
    id: string,
    options: { restock?: RefundLine[] } = {},
  ): Promise<OrderReturnEntity> {
    return this.db.transactional(async () => {
      const received = await this.move(id, "requested", {
        status: "received",
        receivedAt: this.dateTime.nowISOString(),
      });
      await this.orders.restockLines(
        received.orderId,
        options.restock ?? received.lines,
      );
      return received;
    });
  }

  /**
   * @throws InvalidReturnError when it is past being refused
   */
  public async refuse(id: string, note?: string): Promise<OrderReturnEntity> {
    return this.moveFromOpen(id, { status: "refused", note });
  }

  /**
   * Say which refund closed a received return.
   */
  public async markRefunded(
    id: string,
    refundId: string,
  ): Promise<OrderReturnEntity> {
    return this.move(id, "received", { status: "refunded", refundId });
  }

  public async getById(id: string): Promise<OrderReturnEntity> {
    return this.repo.getById(id);
  }

  public async listForOrder(orderId: string): Promise<OrderReturnEntity[]> {
    return this.repo.findMany({
      where: { orderId: { eq: orderId } },
      orderBy: { column: "createdAt", direction: "asc" },
    });
  }

  /**
   * Back-office listing, newest first.
   */
  public async list(
    query: { size?: number; page?: number; status?: OrderReturnStatus } = {},
  ): Promise<Page<OrderReturnEntity>> {
    const where = this.repo.createQueryWhere();
    if (query.status) {
      where.status = { eq: query.status };
    }
    return this.repo.paginate(
      { sort: "-createdAt", ...query },
      { where },
      { count: true },
    );
  }

  /**
   * Whether a return takes every unit the order has not already had back: a
   * withdrawal from the whole order, which brings the delivery back with it.
   */
  public async coversOrder(returned: OrderReturnEntity): Promise<boolean> {
    const items = await this.orders.itemsOf(returned.orderId);
    return items.every((item) => {
      const units = returned.lines
        .filter((line) => line.orderItemId === item.id)
        .reduce((sum, line) => sum + line.quantity, 0);
      return units >= item.quantity - item.cancelledQuantity;
    });
  }

  /**
   * Refuse units the order does not have, or that an open return already
   * covers. A refused return gives its units back to the count.
   */
  protected async assertReturnable(
    orderId: string,
    lines: RefundLine[],
  ): Promise<void> {
    const items = await this.orders.itemsOf(orderId);
    const open = (await this.listForOrder(orderId)).filter(
      (it) => it.status !== "refused",
    );

    for (const line of lines) {
      const item = items.find((it) => it.id === line.orderItemId);
      if (!item) {
        throw new InvalidReturnError(
          `Order ${orderId} has no line ${line.orderItemId}.`,
        );
      }
      const taken = open
        .flatMap((it) => it.lines)
        .filter((it) => it.orderItemId === item.id)
        .reduce((sum, it) => sum + it.quantity, 0);
      const left = item.quantity - item.cancelledQuantity - taken;
      if (line.quantity > left) {
        throw new InvalidReturnError(
          `Cannot return ${line.quantity} of '${item.name}': ${left} left.`,
        );
      }
    }
  }

  protected async moveFromOpen(
    id: string,
    patch: Partial<OrderReturnEntity>,
  ): Promise<OrderReturnEntity> {
    const current = await this.repo.getById(id);
    if (current.status !== "requested" && current.status !== "received") {
      throw new InvalidReturnError(`Return ${id} is '${current.status}'.`);
    }
    return this.move(id, current.status, patch);
  }

  /**
   * Move a return out of `from`, on the database's word. See
   * `OrderService.claim`.
   */
  protected async move(
    id: string,
    from: OrderReturnStatus,
    patch: Partial<OrderReturnEntity>,
  ): Promise<OrderReturnEntity> {
    try {
      return await this.repo.updateOne(
        { id: { eq: id }, status: { eq: from } },
        patch,
      );
    } catch (error) {
      if (error instanceof DbEntityNotFoundError) {
        const current = await this.repo.getById(id);
        throw new InvalidReturnError(
          `Return ${id} is '${current.status}', not '${from}'.`,
        );
      }
      throw error;
    }
  }
}
