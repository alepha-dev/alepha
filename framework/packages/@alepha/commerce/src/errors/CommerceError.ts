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
 * A variant that still appears on order lines cannot be deleted.
 */
export const VariantHasOrdersError = CommerceError.extend({
  name: "VARIANT_HAS_ORDERS",
  default: { status: 409 },
  schema: z.object({ variantId: z.text(), orderLines: z.number() }),
  message: (data) =>
    `Variant ${data.variantId} appears on ${data.orderLines} order line(s) and cannot be deleted. Switch it off instead.`,
});

export type VariantHasOrdersError = InstanceType<typeof VariantHasOrdersError>;

/**
 * A discount code or promotion that does not apply, with the reason a buyer is
 * owed.
 */
export const PromotionRefusedError = CommerceError.extend({
  name: "PROMOTION_REFUSED",
  default: { status: 400 },
  schema: z.object({
    code: z.text(),
    reason: z.enum([
      "invalid",
      "expired",
      "notYet",
      "minimum",
      "usedUp",
      "alreadyUsed",
    ]),
  }),
  message: (data) =>
    ({
      invalid: `'${data.code}' is not a valid code.`,
      expired: `'${data.code}' is no longer valid.`,
      notYet: `'${data.code}' is not valid yet.`,
      minimum: `'${data.code}' needs a higher minimum order.`,
      usedUp: `'${data.code}' has been used up.`,
      alreadyUsed: `You have already used '${data.code}'.`,
    })[data.reason],
});

export type PromotionRefusedError = InstanceType<typeof PromotionRefusedError>;

/**
 * A promotion that has been used cannot be deleted.
 */
export const PromotionInUseError = CommerceError.extend({
  name: "PROMOTION_IN_USE",
  default: { status: 409 },
  schema: z.object({ promotionId: z.text(), used: z.number() }),
  message: (data) =>
    `Promotion ${data.promotionId} has been used ${data.used} time(s) and cannot be deleted. Switch it off instead.`,
});

export type PromotionInUseError = InstanceType<typeof PromotionInUseError>;

/**
 * A category that still holds products or other categories cannot be deleted.
 */
export const CategoryInUseError = CommerceError.extend({
  name: "CATEGORY_IN_USE",
  default: { status: 409 },
  schema: z.object({ categoryId: z.text(), held: z.number() }),
  message: (data) =>
    `Category ${data.categoryId} still holds ${data.held} product(s) or categories. Move them first.`,
});

export type CategoryInUseError = InstanceType<typeof CategoryInUseError>;

/**
 * A refund asking for more than the order has left to give back.
 */
export const InvalidRefundError = CommerceError.extend({
  name: "INVALID_REFUND",
  default: { status: 400 },
  message: "Invalid refund",
});

export type InvalidRefundError = InstanceType<typeof InvalidRefundError>;

/**
 * A return the rules refuse, or a step it is not ready for.
 */
export const InvalidReturnError = CommerceError.extend({
  name: "INVALID_RETURN",
  default: { status: 409 },
  message: "Invalid return",
});

export type InvalidReturnError = InstanceType<typeof InvalidReturnError>;

/**
 * A download link that no longer opens.
 */
export const DownloadUnavailableError = CommerceError.extend({
  name: "DOWNLOAD_UNAVAILABLE",
  default: { status: 410 },
  schema: z.object({ reason: z.enum(["expired", "spent", "refunded"]) }),
  message: (data) =>
    ({
      expired: "This download link has expired.",
      spent: "This download link has been used too many times.",
      refunded: "This order was refunded: its download is closed.",
    })[data.reason],
});

export type DownloadUnavailableError = InstanceType<
  typeof DownloadUnavailableError
>;

/**
 * A VAT number that cannot be accepted: `invalid` by the registry, or
 * `unavailable` because the registry could not be asked. A buyer needs to know
 * which: one is a typo, the other is try again.
 */
export const VatNumberRefusedError = CommerceError.extend({
  name: "VAT_NUMBER_REFUSED",
  default: { status: 400 },
  schema: z.object({
    vatNumber: z.text(),
    reason: z.enum(["invalid", "unavailable"]),
  }),
  message: (data) =>
    data.reason === "invalid"
      ? `'${data.vatNumber}' is not a valid VAT number.`
      : `'${data.vatNumber}' cannot be checked at the moment. Try again later.`,
});

export type VatNumberRefusedError = InstanceType<typeof VatNumberRefusedError>;

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
