# @alepha/commerce - Invoicing

## Installation

```bash
npm install @alepha/commerce
```

## Overview

Gapless, frozen invoices with a per-rate tax breakdown.

Not optional in France: a B2C sale must be invoiced, the numbering must have
no holes, and the tax must be shown per rate. A separate module all the same,
because Ticketing and a POS have their own fiscal obligations and different
documents to produce.

An invoice is issued when an order is paid and a credit note when it is
refunded, both by the jobs of `@alepha/commerce/settlement`, which an
application imports alongside this. Configure the seller first, or every
invoice will claim to come from "Unnamed seller":

```ts
alepha.store.set(sellerIdentityAtom.key, {
  name: "Atelier Aurore",
  address: "12 rue des Orfèvres, 75001 Paris",
  registrationNumber: "912 345 678 00012",
  vatNumber: "FR91234567800",
  numberPrefix: "FA",
});
```

## API Reference

### Providers

- [`HtmlInvoiceRenderer`](/docs/reference-providers-htmlinvoicerenderer) - Renders a print-ready, legally complete invoice as HTML.
- [`InvoiceRenderer`](/docs/reference-providers-invoicerenderer) - Turns an invoice row into something a customer can keep.
