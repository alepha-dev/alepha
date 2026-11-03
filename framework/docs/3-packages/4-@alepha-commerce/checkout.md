# @alepha/commerce - Checkout

## Installation

```bash
npm install @alepha/commerce
```

## Overview

Turns a cart into a paid order.

Depends on the cart module and on `alepha/api/payments`, which owns the
intent lifecycle and the PSP adapters. Registers hosted-redirect payment by
default - the one handoff every PSP supports - leaving an embedded card field
to a substitution:

```ts
alepha.with({
  provide: CheckoutPaymentProvider,
  use: EmbeddedCheckoutPayment,
});
```

## API Reference

### Providers

- [`AddressRulesProvider`](/docs/reference-providers-addressrulesprovider) - Per-country address rules for the EU.
- [`CheckoutPaymentProvider`](/docs/reference-providers-checkoutpaymentprovider) - Bridges a checkout session to a payment rail.
- [`EmbeddedCheckoutPayment`](/docs/reference-providers-embeddedcheckoutpayment) - Takes payment in a card field hosted on our own page.
- [`OrderDocumentsProvider`](/docs/reference-providers-orderdocumentsprovider) - What documents exist for an order - invoice numbers, in practice.
- [`RedirectCheckoutPayment`](/docs/reference-providers-redirectcheckoutpayment) - Takes payment by sending the browser to the PSP's hosted page.
- [`ShippingQuoteProvider`](/docs/reference-providers-shippingquoteprovider) - Where the checkout asks what delivery costs.
- [`VatNumberChecker`](/docs/reference-providers-vatnumberchecker) - Asks whether a VAT number exists. Abstract so a shop can use its own source
