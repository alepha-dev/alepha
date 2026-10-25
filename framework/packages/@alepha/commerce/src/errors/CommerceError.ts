import { z } from "alepha";
import { HttpError } from "alepha/server";

/**
 * Base error for the commerce domain: an HTTP error answering 500 unless a
 * descendant says otherwise.
 *
 * Every refusal the caller can act on (an invalid postcode, a product out of
 * stock) declares its own 4xx status, so the router answers it accurately and
 * a strict `$action` can declare it. Throwing one needs no HTTP anywhere: the
 * services stay usable from a CLI, a job or a test.
 */
export const CommerceError = HttpError.extend({
  name: "COMMERCE",
  default: { status: 500 },
  message: "Commerce error",
});

export type CommerceError = InstanceType<typeof CommerceError>;

/**
 * A product declares a `kind` that no module has registered. A payload
 * naming a kind nobody owns is a bad request, not a server fault.
 */
export const UnknownProductKindError = CommerceError.extend({
  name: "UNKNOWN_PRODUCT_KIND",
  default: { status: 400 },
  schema: z.object({ kind: z.text(), known: z.array(z.text()) }),
  message: (data) =>
    `Unknown product kind '${data.kind}'. Registered kinds: ${
      data.known.length > 0 ? data.known.join(", ") : "(none)"
    }. A module must register a ProductKindHandler for it.`,
});

export type UnknownProductKindError = InstanceType<
  typeof UnknownProductKindError
>;

/**
 * Two modules registered a handler for the same product kind: a boot-time
 * programming error, so it stays a 500.
 */
export const DuplicateProductKindError = CommerceError.extend({
  name: "DUPLICATE_PRODUCT_KIND",
  schema: z.object({ kind: z.text() }),
  message: (data) =>
    `Product kind '${data.kind}' is already registered. Two modules cannot own the same kind.`,
});

export type DuplicateProductKindError = InstanceType<
  typeof DuplicateProductKindError
>;

/**
 * A shipping address the shop cannot deliver to as written. `field` names
 * the input to highlight.
 */
export const InvalidAddressError = CommerceError.extend({
  name: "INVALID_ADDRESS",
  default: { status: 400 },
  schema: z.object({ field: z.text() }),
  message: "Invalid address",
});

export type InvalidAddressError = InstanceType<typeof InvalidAddressError>;

/**
 * No shipping rate covers the destination country.
 */
export const NoShippingRateError = CommerceError.extend({
  name: "NO_SHIPPING_RATE",
  default: { status: 400 },
  schema: z.object({ country: z.text() }),
  message: (data) => `No shipping rate is configured for '${data.country}'.`,
});

export type NoShippingRateError = InstanceType<typeof NoShippingRateError>;

/**
 * A product that still appears on order lines cannot be deleted.
 */
export const ProductHasOrdersError = CommerceError.extend({
  name: "PRODUCT_HAS_ORDERS",
  default: { status: 409 },
  schema: z.object({ productId: z.text(), orderLines: z.number() }),
  message: (data) =>
    `Product ${data.productId} appears on ${data.orderLines} order line(s) and cannot be deleted. Unpublish it instead to remove it from the shop while keeping order history readable.`,
});

export type ProductHasOrdersError = InstanceType<typeof ProductHasOrdersError>;

/**
 * Not enough stock on hand for the requested quantity.
 */
export const InsufficientStockError = CommerceError.extend({
  name: "INSUFFICIENT_STOCK",
  default: { status: 409 },
  schema: z.object({
    productId: z.text(),
    requested: z.number(),
    onHand: z.number(),
  }),
  message: (data) =>
    `Insufficient stock for product ${data.productId}: requested ${data.requested}, on hand ${data.onHand}.`,
});

export type InsufficientStockError = InstanceType<
  typeof InsufficientStockError
>;

/**
 * A bookable resource has no room for the requested interval.
 */
export const ResourceUnavailableError = CommerceError.extend({
  name: "RESOURCE_UNAVAILABLE",
  default: { status: 409 },
  schema: z.object({
    resourceId: z.text(),
    interval: z.object({ startsAt: z.text(), endsAt: z.text() }),
    requested: z.number(),
    capacity: z.number(),
  }),
  message: (data) =>
    `Resource ${data.resourceId} has no room for ${data.requested} over [${data.interval.startsAt}, ${data.interval.endsAt}) at capacity ${data.capacity}.`,
});

export type ResourceUnavailableError = InstanceType<
  typeof ResourceUnavailableError
>;

/**
 * A booking interval that is empty, reversed or misaligned.
 */
export const InvalidIntervalError = CommerceError.extend({
  name: "INVALID_INTERVAL",
  default: { status: 400 },
  message: "Invalid interval",
});

export type InvalidIntervalError = InstanceType<typeof InvalidIntervalError>;

/**
 * An order line whose configuration the product kind refuses.
 */
export const InvalidLineError = CommerceError.extend({
  name: "INVALID_LINE",
  default: { status: 400 },
  message: "Invalid line",
});

export type InvalidLineError = InstanceType<typeof InvalidLineError>;
