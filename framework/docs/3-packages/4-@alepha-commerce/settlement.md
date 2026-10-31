# @alepha/commerce - Settlement

## Installation

```bash
npm install @alepha/commerce
```

## Overview

Durable checkout outcomes, four jobs:

- **orderSettlement**: invoice and confirmation email as one keyed
  `$job` with retry and admin visibility, replacing the fire-and-forget
  listeners that silently dropped a failed invoice.
- **shippingNotice**: the "it's on its way" email, with the same retry and
  visibility.
- **refundCreditNote**: the credit note of each refund, likewise.
- **checkoutReconciliation**: one delayed execution per payment handoff:
  a checkout still `paying` after the wait gets the PSP polled
  (recovering payments whose webhook never arrived, the
  Mollie-without-webhook case) and is settled or abandoned either way.

Import this ALONGSIDE `@alepha/commerce/invoicing` and/or
`@alepha/commerce/notifications`: the settlement stages activate for
whichever of the two is loaded and skip cleanly otherwise. Without this
module, invoicing and notifications do nothing on the paid transition:
the paid-path side effects live here, on purpose, so they can never run
twice.
