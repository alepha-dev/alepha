/**
 * English strings for `@alepha/commerce`'s back-office components.
 *
 * ### Why an English catalogue exists at all, when the defaults are English
 *
 * `tr()` resolves a missing key against the application's `fallbackLang`
 * dictionary BEFORE it reaches the `default:` written in the component. So in
 * an application whose fallback is French (`apps/examples/shop`), spreading
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
 * let the component defaults answer: the values here are identical to them.
 * Keep it that way: this file is the same text, in a form `tr()` can reach.
 *
 * ### The `$1` entries are not duplicates of a default
 *
 * Six strings interpolate (`restockConfirm`, `refundConfirm`, …). Their
 * component default is a template literal built from real values, while a
 * catalogue entry has to use `$1` placeholders, so those, uniquely, cannot be
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
  "commerce.checkout.pay": "Pay",
  "commerce.checkout.declined": "The payment was declined.",
  "commerce.checkout.paymentSent": "Payment sent…",
  "commerce.admin.detail.back": "Back to the catalogue",
  "commerce.admin.detail.created": "Created",
  "commerce.admin.detail.delete": "Delete",
  "commerce.admin.detail.deleteConfirm":
    "Permanently delete “$1”? This cannot be undone.",
  "commerce.admin.detail.deleteCta": "Delete",
  "commerce.admin.detail.deleteError": "Could not delete this product",
  "commerce.admin.detail.deleteTitle": "Delete product",
  "commerce.admin.detail.deleted": "Product deleted.",
  "commerce.admin.detail.id": "ID",
  "commerce.admin.detail.kind": "Type",
  "commerce.admin.detail.loadError": "Failed to load the product",
  "commerce.admin.detail.notFound": "Product not found.",
  "commerce.admin.detail.price": "Price",
  "commerce.admin.detail.slug": "Reference",
  "commerce.admin.detail.status": "Status",
  "commerce.admin.detail.tabDetails": "Details",
  "commerce.admin.detail.tabMedia": "Images",
  "commerce.admin.detail.tabOrders": "Orders",
  "commerce.admin.detail.tabOverview": "Overview",
  "commerce.admin.detail.tabStock": "Stock",
  "commerce.admin.detail.vat": "VAT",
  "commerce.admin.detail.vatDefault": "Seller default",
  "commerce.admin.details.attrAdd": "Add",
  "commerce.admin.details.attrName": "Name",
  "commerce.admin.details.attrRemove": "Remove attribute",
  "commerce.admin.details.attrValue": "Value",
  "commerce.admin.details.attributesEmpty": "No attribute yet.",
  "commerce.admin.details.attributesHint":
    "Descriptive details the shop displays, such as material or dimensions. Not used in any calculation.",
  "commerce.admin.details.attributesSaved": "Attributes saved.",
  "commerce.admin.details.attributesTitle": "Attributes",
  "commerce.admin.details.configHint":
    "Settings the '$1' type requires. Validated when saved.",
  "commerce.admin.details.configSaved": "Configuration saved.",
  "commerce.admin.details.configTitle": "Type configuration",
  "commerce.admin.draftFailed": "Could not create the product",
  "commerce.admin.fCurrency": "Currency",
  "commerce.admin.fVatRate": "VAT rate (basis points)",
  "commerce.admin.fVatRateHint":
    "2000 = 20.00 %. Leave empty to bill at the seller's default rate.",
  "commerce.admin.media.empty": "This product has no image yet.",
  "commerce.admin.media.hint":
    "The first image is the one the shop shows in listings. Use the arrows to change the order.",
  "commerce.admin.media.listing": "Listing",
  "commerce.admin.media.moveEarlier": "Move earlier",
  "commerce.admin.media.moveLater": "Move later",
  "commerce.admin.media.saved": "Images saved.",
  "commerce.admin.media.title": "Images",
  "commerce.admin.media.upload": "Add images",
  "commerce.admin.orders.colOrder": "Order",
  "commerce.admin.orders.colQuantity": "Qty",
  "commerce.admin.orders.colStatus": "Status",
  "commerce.admin.orders.colTotal": "Total",
  "commerce.admin.orders.colUnitPrice": "Unit price",
  "commerce.admin.orders.colWhen": "Date",
  "commerce.admin.orders.empty": "This product has never been ordered.",
  "commerce.admin.stock.adjustCta": "Record",
  "commerce.admin.stock.adjustHint":
    "Records a movement in the ledger below. Use a negative quantity with 'Adjustment' to write stock off.",
  "commerce.admin.stock.adjustTitle": "Correct the count",
  "commerce.admin.stock.adjusted": "Stock updated.",
  "commerce.admin.stock.colDelta": "Change",
  "commerce.admin.stock.colNote": "Note",
  "commerce.admin.stock.colReason": "Reason",
  "commerce.admin.stock.colWhen": "When",
  "commerce.admin.stock.fNote": "Note",
  "commerce.admin.stock.fQuantity": "Quantity",
  "commerce.admin.stock.fReason": "Reason",
  "commerce.admin.stock.ledgerEmpty": "No stock movement recorded yet.",
  "commerce.admin.stock.ledgerTitle": "Movement history",
  "commerce.admin.stock.reasonAdjustment": "Adjustment",
  "commerce.admin.stock.reasonIntake": "Intake",
  "commerce.admin.stock.reasonReturn": "Return",
  "commerce.admin.stock.reasonSale": "Sale",
};
