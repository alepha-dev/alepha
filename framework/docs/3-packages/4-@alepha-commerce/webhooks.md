# @alepha/commerce - Webhooks

## Installation

```bash
npm install @alepha/commerce
```

## Overview

Commerce order events as outbound webhooks: `order.paid`, `order.shipped`,
`order.refunded`, `order.cancelled` and `return.requested`, for the tools
a shop connects (fulfilment, accounting, an automation).

Opt-in: a shop that does not register it gets no webhook table and no
admin entry. It registers `AlephaApiWebhooks`, so the admin's Webhooks
page appears with it.

The events are sent after the order's commit, not atomically with it.
`order.paid` and `order.shipped` carry the shipping recipient's name and
postal address; no event carries the customer's email, a phone number,
billing details, a VAT number or a user id.
