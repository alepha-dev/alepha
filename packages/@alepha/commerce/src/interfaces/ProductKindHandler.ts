import type { ZType } from "alepha";

import type { OrderItemEntity } from "../entities/orderItems.ts";
import type { ProductEntity } from "../entities/products.ts";
import type { ClaimLockKey } from "../services/ClaimLock.ts";

/**
 * What a module must implement to teach the catalog a new kind of sellable
 * thing.
 *
 * A handler is an ordinary service, so it may `$inject` whatever it needs — the
 * point-of-sale handler injects the wallet, a ticketing handler injects the QR
 * issuer. It is registered with `ProductKindRegistry` from its module's
 * `register()` hook.
 */
export abstract class ProductKindHandler {
  /**
   * The `products.kind` value this handler owns. Must be unique across the
   * whole application — the registry rejects a duplicate rather than letting
   * the last module registered win silently.
   */
  abstract readonly kind: string;

  /**
   * Schema for `products.config`. Validated by `CatalogService` on write, so a
   * malformed product cannot reach the catalog. Return `undefined` when the
   * kind takes no configuration.
   */
  abstract readonly configSchema?: ZType;

  /**
   * Schema for the line config a buyer sends with a line of this kind
   * (`cartItems.lineConfig`, then `orderItems.lineConfig`): what varies from
   * one line of the same product to the next. For a court, the resource and
   * the interval; a `good` has none and leaves this unset, and a line config
   * sent for it is refused.
   *
   * Kept apart from {@link configSchema} on purpose. The product's config is
   * the merchant's; the line config comes from the buyer, so it can never be
   * allowed to override the product's keys (`{ trackStock: false }` on a
   * `good` would sell without touching the ledger).
   */
  readonly lineSchema?: ZType;

  /**
   * Refuse a line this product cannot sell: a court that is not one of the
   * product's, an interval that is not on its grid, a start already past, a
   * quantity a court cannot take. Called after {@link lineSchema} has parsed
   * the config, when a line is added to a cart, re-read when the cart is
   * priced (a refused line is dropped from the cart), and again when the
   * order is created. The line config is untrusted input: this is the
   * boundary.
   *
   * Throw a `CommerceError` (an `InvalidLineError`, typically): anything else
   * is treated as a fault, not as a refusal.
   */
  validateLine?(
    product: ProductEntity,
    lineConfig: Record<string, any>,
    quantity: number,
  ): Promise<void>;

  /**
   * The unit price of a line, computed on the server. Defaults to
   * `product.price`; a kind whose price depends on the line (a peak-hour
   * slot) implements this.
   *
   * Live, never frozen on the cart line: `CartService.price` and
   * `OrderService.create` both call it, and the order line then freezes what
   * was charged.
   */
  unitPrice?(
    product: ProductEntity,
    lineConfig: Record<string, any> | undefined,
  ): Promise<number>;

  /**
   * The claim locks this line will take, so `OrderService` can take every lock
   * of an order up front, sorted, before any handler runs.
   *
   * On Postgres each claim holds a lock until the order commits, and two
   * orders taking the same locks in different orders deadlock, which Postgres
   * breaks by failing one checkout. Walking the lines in some order is not
   * enough: one product sells many resources, and one line can claim several
   * (a seat over two legs). So every key of every line is collected, sorted by
   * `(namespace, key)` and taken first; the handler's own claims then find
   * their locks already held.
   *
   * A kind that claims through `StockService` or `ResourceService` implements
   * this (`good` returns its product's stock key, a resource kind one key per
   * resource); a kind that claims nothing leaves it unset.
   */
  lockKeys?(item: OrderItemEntity): ClaimLockKey[];

  /**
   * Optionally hold whatever this line consumes, while its payment is in flight.
   *
   * Symmetric with {@link fulfil}: `good` holds stock so two buyers cannot both
   * reach the payment page for the last one; a ticketing `seat` would hold the
   * seat. A download holds nothing and simply does not implement this.
   *
   * Called when the order is created `pending`. Holds are released
   * automatically if the payment never settles, so an implementation does not
   * need its own expiry.
   */
  reserve?(item: OrderItemEntity): Promise<void>;

  /**
   * Run when a line of this kind is paid for.
   *
   * This is the extension point that makes the whole design modular: core's
   * `good` decrements stock, a POS `wallet_topup` credits a wallet, a
   * ticketing `seat` emits a QR code. The core never learns what any of them
   * mean.
   *
   * Called inside the order's transaction, so a throw rolls the whole order
   * back. Must be idempotent on `item.id`: payment webhooks are re-delivered.
   */
  abstract fulfil(item: OrderItemEntity): Promise<void>;
}
