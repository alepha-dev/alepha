# Commerce

`@alepha/commerce` is a headless shop: catalog, cart, checkout, orders, invoices. It runs on `alepha/api/payments`, so any payment provider works, and it is a set of modules you import one by one: a point-of-sale takes the core and leaves the cart behind.

```bash
yarn add @alepha/commerce @alepha/ui
```

## Modules

| Module                           | What it adds                                                          |
| -------------------------------- | --------------------------------------------------------------------- |
| `@alepha/commerce`               | Catalog, categories, variants, orders, stock and interval ledgers     |
| `@alepha/commerce/cart`          | Server-side baskets behind a signed cookie                            |
| `@alepha/commerce/checkout`      | The checkout session, addresses, VAT, the handoff to the payment rail |
| `@alepha/commerce/shipping`      | Delivery zones and rates                                              |
| `@alepha/commerce/promotions`    | Discount codes and automatic discounts                                |
| `@alepha/commerce/invoicing`     | Gapless invoices and credit notes                                     |
| `@alepha/commerce/notifications` | The confirmation and shipping emails                                  |
| `@alepha/commerce/settlement`    | The durable jobs: invoice, confirmation, credit note, reconciliation  |
| `@alepha/commerce/downloads`     | Digital goods: expiring, counted links                                |
| `@alepha/commerce/recovery`      | Abandoned-cart reminders, with consent                                |
| `@alepha/commerce/admin`         | The back-office API; its React screens are `admin/components/*`       |
| `@alepha/commerce/vat`           | The VAT arithmetic alone                                              |

A shop imports the ones it needs:

```ts
import { AlephaCommerceAdmin } from "@alepha/commerce/admin";
import { AlephaCommerceInvoicing } from "@alepha/commerce/invoicing";
import { AlephaCommerceNotifications } from "@alepha/commerce/notifications";
import { AlephaCommercePromotions } from "@alepha/commerce/promotions";
import { AlephaCommerceSettlement } from "@alepha/commerce/settlement";
import { AlephaCommerceShipping } from "@alepha/commerce/shipping";
import { $module } from "alepha";

export const ShopApi = $module({
  name: "shop.api",
  imports: [
    // Before anything that imports the checkout: shipping substitutes into it.
    AlephaCommerceShipping,
    AlephaCommercePromotions,
    AlephaCommerceInvoicing,
    AlephaCommerceNotifications,
    AlephaCommerceSettlement,
    AlephaCommerceAdmin,
  ],
});
```

Invoices, confirmation emails and credit notes are jobs in `AlephaCommerceSettlement`: without that module, invoicing and notifications do nothing on a sale.

## Products, kinds and variants

A product has a `kind`, and the handler registered for it decides what selling one means. The core ships `good` (stock-tracked) and `digital`. An application adds its own by subclassing `ProductKindHandler`; `ResourceKindHandler` is the base for anything sold by the interval, a court or a seat.

A product with option groups sells through variants, each with its own SKU, stock and optional price. A line on such a product must name one:

```ts
const ring = await catalog.create({
  slug: "alliance-zenith",
  name: "Alliance Zénith",
  price: 42000,
  published: true,
  optionGroups: [{ name: "Taille", values: ["50", "54"] }],
});

const variant = await variants.create(ring.id, {
  sku: "ZENITH-54",
  options: { Taille: "54" },
});
await stock.recordIntake(ring.id, 3, { variantId: variant.id });
```

`VariantService.generate` writes the missing combinations of the option groups, and leaves what exists alone.

The public list, `GET /api/commerce/products`, takes `category` (a slug, with everything under it), `q`, `minPrice`, `maxPrice`, `available` and `sort`.

## Stock

Stock is a ledger, never a counter. `onHand` sums its movements, `reserved` sums the live holds, and `available` is one minus the other: what a storefront shows. A hold is taken when the checkout reaches payment and lives 30 minutes. On Postgres a claim takes an advisory lock; on SQLite and D1 it replays the ledger, so concurrent buyers cannot oversell either way.

## Checkout

A checkout session moves from a cart to a paid order: `start`, `setEmail`, `setAddress`, `setShippingMethod`, `pay`. Settlement arrives later, from the payment webhook, through `payments:captured`. Every action checks that the caller holds the session's cart cookie or is its signed-in user.

A capture that lands after its hold expired and its stock was sold becomes a stray capture: the order is cancelled, the money is recorded on it, and `commerce:capture:strayDetected` fires. Nobody is refunded automatically.

## Promotions

A promotion takes a percentage or an amount off, or makes delivery free, with an optional minimum order, validity window and usage limits. With a `code` the buyer asks for it; without one it applies to every cart that qualifies, and the best one wins. A cart takes one promotion, and an applied code beats an automatic one.

```ts
await promotions.create({
  name: "Bienvenue",
  code: "BIENVENUE10",
  kind: "percent",
  value: 1000, // basis points: 10 %
  usagePerCustomer: 1,
});
```

A discount lowers the tax-inclusive lines before VAT is computed, and the order and the invoice freeze it.

## Tax

Prices are tax-inclusive, and `TaxService` extracts the VAT they contain. `taxConfig` holds the rules:

```ts
alepha.store.set(taxConfig.key, {
  defaultRateBps: 2000,
  originCountry: "FR",
  // Past the EU's 10,000 euro threshold of cross-border B2C sales.
  distanceSelling: true,
  countries: {
    DE: { standardBps: 1900, reduced: { "550": 700 } },
  },
  reverseCharge: true,
});
```

With `distanceSelling` on, a line and its delivery pay the delivery country's rate. `countries` starts empty on purpose, and a destination missing from it refuses the checkout: a rate a package shipped is a rate nobody updated.

With `reverseCharge` on, a buyer in another EU country whose number passes VIES (`setVatNumber`) pays net, and the invoice carries the number and the statutory mention.

## Refunds, credit notes and returns

The back office refunds an amount, some lines, or everything left, through the payment rail first. A credit note follows by itself, for what was refunded, and the notes of a fully refunded order add up to its invoice, rate by rate. A full refund restocks only an order that never shipped.

A return goes `requested`, `received`, then `refunded` or `refused`. A customer requests one within `orderConfig.withdrawalDays` of delivery; receiving it restocks what can be sold again; refunding it goes by line, or everything left, delivery included, when it takes the whole order. Lines of an order that has not shipped are cancelled instead.

## Digital goods

A `digital` product's `config.fileId` names a file in `alepha/api/files`, in a storage no public route serves. With `AlephaCommerceDownloads`, each paid line gets a link in the confirmation email and on the thank-you page, which stops at its expiry, its download limit or a refund. Set `downloadConfig.baseUrl`, or the links in emails are relative.

## Cart reminders

`AlephaCommerceRecovery` sends two reminders for an abandoned cart, only to a buyer who agreed (`recoveryConsent`, never pre-ticked), with a one-click unsubscribe the mail client understands. Set `cartRecoveryConfig.baseUrl`, for the same reason.

## Admin

`AlephaCommerceAdmin` serves the back-office API, under the permissions `admin:commerce:read`, `admin:commerce:write` and `admin:commerce:refund`. Its screens are React components you mount in your own admin:

```ts
import { AdminOrders } from "@alepha/commerce/admin/components/admin-orders";
```

Import the Tailwind sources once, after the design system's, and spread the catalogues into your dictionaries:

```css
@import "@alepha/ui/styles.css";
@import "@alepha/commerce/styles.css";
```

`apps/examples/shop` is a whole shop built on all of this.
