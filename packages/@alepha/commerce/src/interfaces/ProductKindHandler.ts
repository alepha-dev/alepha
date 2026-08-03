import type { ZType } from "alepha";
import type { OrderItemEntity } from "../entities/orderItems.ts";

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
