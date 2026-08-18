/**
 * English strings for `@alepha/commerce`'s back-office components.
 *
 * ### Why an English catalogue exists at all, when the defaults are English
 *
 * `tr()` resolves a missing key against the application's `fallbackLang`
 * dictionary BEFORE it reaches the `default:` written in the component. So in
 * an application whose fallback is French — `apps/example-shop` — spreading
 * {@link commerceFr} alone does not leave English on the defaults, it renders
 * the French catalogue to English users. The back office came out with an
 * English shell around a French table: "Produit", "Prix", "Ajouté".
 *
 * These two files therefore ship as a pair, and an application that spreads
 * one spreads both:
 *
 * ```ts
 * fr = $dictionary({ lazy: async () => ({ default: { ...commerceFr } }) });
 * en = $dictionary({ lazy: async () => ({ default: { ...commerceEn } }) });
 * ```
 *
 * An application whose `fallbackLang` is already English can skip this one and
 * let the component defaults answer — the values here are identical to them.
 * Keep it that way: this file is the same text, in a form `tr()` can reach.
 *
 * ### The `$1` entries are not duplicates of a default
 *
 * Six strings interpolate (`restockConfirm`, `refundConfirm`, …). Their
 * component default is a template literal built from real values, while a
 * catalogue entry has to use `$1` placeholders — so those, uniquely, cannot be
 * copied across verbatim.
 */
export const commerceEn: Record<string, string> = {
  "commerce.admin.address": "Delivery address",
  "commerce.admin.allKinds": "All types",
  "commerce.admin.allStatuses": "All statuses",
  "commerce.admin.availableLabel": "Available",
  "commerce.admin.colCreated": "Added",
  "commerce.admin.colKind": "Type",
  "commerce.admin.colName": "Product",
  "commerce.admin.colPrice": "Price",
  "commerce.admin.colShipping": "Shipping",
  "commerce.admin.colStatus": "Status",
  "commerce.admin.colStock": "Stock",
  "commerce.admin.colTotal": "Total",
  "commerce.admin.colWhen": "Date",
  "commerce.admin.delay": "Lead time",
  "commerce.admin.deliver": "Mark received",
  "commerce.admin.deliverConfirm":
    "Has the customer confirmed the parcel arrived?",
  "commerce.admin.deliverTitle": "Mark as received",
  "commerce.admin.draft": "Draft",
  "commerce.admin.edit": "Edit",
  "commerce.admin.fDescription": "Description",
  "commerce.admin.fKind": "Type",
  "commerce.admin.fName": "Name",
  "commerce.admin.fPrice": "Price incl. tax (cents)",
  "commerce.admin.fPublished": "On sale",
  "commerce.admin.fSlug": "Reference",
  "commerce.admin.fSlugHint":
    "Appears in the URL. Do not change it once the product is on sale.",
  "commerce.admin.freeAbove": "Free above",
  "commerce.admin.freeAboveCents": "Free above (cents)",
  "commerce.admin.lines": "Items",
  "commerce.admin.loading": "Loading…",
  "commerce.admin.maxDays": "Max. lead time (days)",
  "commerce.admin.minDays": "Min. lead time (days)",
  "commerce.admin.newProduct": "New product",
  "commerce.admin.newRate": "New rate",
  "commerce.admin.noOrders": "No orders.",
  "commerce.admin.noProducts": "No products in the catalogue.",
  "commerce.admin.noRates": "No shipping rate in this zone.",
  "commerce.admin.offered": "Offered",
  "commerce.admin.onHandLabel": "On hand",
  "commerce.admin.online": "Online",
  "commerce.admin.publish": "Put on sale",
  "commerce.admin.publishConfirm": "“$1” will be visible and purchasable.",
  "commerce.admin.publishTitle": "Put on sale",
  "commerce.admin.rateCode": "Code",
  "commerce.admin.rateCodeHint":
    "Written on the order. Do not change it afterwards.",
  "commerce.admin.rateName": "Rate",
  "commerce.admin.ratePrice": "Price",
  "commerce.admin.ratePriceCents": "Price incl. tax (cents)",
  "commerce.admin.refund": "Refund",
  "commerce.admin.refundConfirm":
    "Refund $1 to the customer? The money goes back to them and the stock is released. A credit note is issued.",
  "commerce.admin.refundTitle": "Refund",
  "commerce.admin.refunded": "Order refunded.",
  "commerce.admin.reserved": "reserved",
  "commerce.admin.reservedLabel": "Reserved",
  "commerce.admin.restock": "Restock",
  "commerce.admin.restockConfirm": "Add one unit of “$1” to stock?",
  "commerce.admin.restockTitle": "Restock",
  "commerce.admin.restocked": "“$1”: +1 in stock.",
  "commerce.admin.save": "Save",
  "commerce.admin.saved": "Product saved.",
  "commerce.admin.ship": "Ship",
  "commerce.admin.shipConfirm": "Ship",
  "commerce.admin.shipHint":
    "Tracking number, if there is one. The customer receives it by email.",
  "commerce.admin.shipTitle": "Hand to the carrier",
  "commerce.admin.shippingLine": "Shipping",
  "commerce.admin.unpublish": "Remove from sale",
  "commerce.admin.unpublishConfirm":
    "“$1” will disappear from the shop. Orders already placed are unchanged.",
  "commerce.admin.unpublishTitle": "Remove from sale",
  "commerce.admin.vat": "incl. VAT",
  "commerce.admin.withdraw": "Withdraw",
  "commerce.admin.withdrawRate": "Withdraw this rate",
  "commerce.admin.withdrawRateConfirm":
    "“$1” is no longer offered at checkout. Past orders keep it, and you can put it back later.",
  "commerce.admin.withdrawn": "Withdrawn",
  "commerce.status.cancelled": "Cancelled",
  "commerce.status.delivered": "Delivered",
  "commerce.status.fulfilled": "Fulfilled",
  "commerce.status.paid": "Paid",
  "commerce.status.pending": "Pending",
  "commerce.status.refunded": "Refunded",
  "commerce.status.shipped": "Shipped",
};
