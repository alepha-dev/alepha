# Alepha @alepha/commerce

Headless commerce for Alepha apps: catalog, cart, checkout. Extended by product-kind handlers.

## Installation

Part of the Alepha framework, published on its own:

```bash
npm install @alepha/commerce
```

## Module

Headless commerce core: catalog, orders, and two inventory ledgers.

- **Fungible stock** (`StockService`): a quantity on a product, sold by the
  `good` kind.
- **Interval claims on named resources** (`ResourceService`): a court, a
  seat on a leg, a room on a night, sold by an application's subclass of
  `ResourceKindHandler`.

Ships two product kinds - `good` (stock-tracked) and `digital` - and the
registry that lets any other module add more without editing this package.
Cart and checkout are separate modules (`@alepha/commerce/cart`,
`@alepha/commerce/checkout`) so a consumer that has no use for them, such as
a point-of-sale, does not carry their tables.

## API Reference

### Providers

- [`OrderDownloadsProvider`](https://alepha.dev/docs/reference-providers-orderdownloadsprovider) - What can be downloaded for an order: read by the confirmation email and the
- [`ProductKindRegistry`](https://alepha.dev/docs/reference-providers-productkindregistry) - Extension point letting any module teach the catalog a new kind of sellable
