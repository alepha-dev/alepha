import { AlephaError } from "alepha";

/**
 * Base error for the commerce domain.
 *
 * ### Why subclasses carry a numeric `status`
 *
 * `ServerRouterProvider` maps any thrown error that has a numeric `status` onto
 * that HTTP status — it duck-types rather than requiring `HttpError`. That is the
 * seam this domain uses: an invalid postcode answers 400 without a single import
 * from `alepha/server`, so the services stay usable from a CLI, a job or a test
 * with no HTTP anywhere.
 *
 * Without it, every one of these surfaced as a 500 — which is what the first
 * end-to-end run of the address form actually did.
 */
export class CommerceError extends AlephaError {
  override name = "CommerceError";
}

/**
 * A product declares a `kind` that no module has registered.
 */
export class UnknownProductKindError extends CommerceError {
  override name = "UnknownProductKindError";
  /**
   * A payload naming a kind nobody owns is a bad request, not a server fault.
   */
  public readonly status = 400;

  constructor(kind: string, known: string[]) {
    super(
      `Unknown product kind '${kind}'. Registered kinds: ${
        known.length > 0 ? known.join(", ") : "(none)"
      }. A module must register a ProductKindHandler for it.`,
    );
  }
}

/**
 * Two modules claim the same `kind`.
 */
export class DuplicateProductKindError extends CommerceError {
  override name = "DuplicateProductKindError";

  constructor(kind: string) {
    super(
      `Product kind '${kind}' is already registered. Two modules cannot own the same kind.`,
    );
  }
}

/**
 * An address failed its country's rules.
 *
 * Carries the offending field so a form can highlight it instead of showing a
 * generic banner.
 */
export class InvalidAddressError extends CommerceError {
  override name = "InvalidAddressError";
  public readonly status = 400;

  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * No shipping rate covers the destination.
 */
export class NoShippingRateError extends CommerceError {
  override name = "NoShippingRateError";
  public readonly status = 400;

  constructor(country: string) {
    super(`No shipping rate is configured for '${country}'.`);
  }
}

/**
 * A product cannot be deleted because it has been sold.
 *
 * Order lines snapshot everything they need, so nothing would *break* — but the
 * catalogue row is what answers "what was this line?" when someone reads an old
 * invoice, and deleting is not undoable. Unpublishing achieves what the
 * operator wanted without destroying that.
 */
export class ProductHasOrdersError extends CommerceError {
  override name = "ProductHasOrdersError";
  /**
   * 409 for the same reason as {@link InsufficientStockError}: the request is
   * well-formed and the id is real. What refuses it is the state of the world.
   */
  public readonly status = 409;

  constructor(
    productId: string,
    public readonly orderLines: number,
  ) {
    super(
      `Product ${productId} appears on ${orderLines} order line(s) and cannot be deleted. Unpublish it instead to remove it from the shop while keeping order history readable.`,
    );
  }
}

/**
 * Not enough on-hand stock to satisfy a sale.
 */
export class InsufficientStockError extends CommerceError {
  override name = "InsufficientStockError";
  /**
   * 409, not 400: the request was well-formed and was valid a moment ago. What
   * changed is the state of the world, and that distinction is what tells a
   * client to re-read availability rather than to fix its payload.
   */
  public readonly status = 409;

  constructor(productId: string, requested: number, onHand: number) {
    super(
      `Insufficient stock for product ${productId}: requested ${requested}, on hand ${onHand}.`,
    );
  }
}
