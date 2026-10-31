# EmbeddedCheckoutPayment

## Import

```typescript
import { EmbeddedCheckoutPayment } from "@alepha/commerce/checkout";
```

## Overview

Takes payment in a card field hosted on our own page.

PSP-agnostic: it asks `alepha/api/payments` for an element session and passes
back whatever the installed provider returned, including the `provider` name
the browser dispatches on. Nothing about Stripe appears here, which is what
makes swapping PSP a configuration change rather than a rewrite of the
checkout.

Register it in place of the default redirect:

```ts
alepha.with({
  provide: CheckoutPaymentProvider,
  use: EmbeddedCheckoutPayment,
});
```

### The cost this carries, stated plainly

Keeping the payer on the page does not remove the trip to their bank: 3-D
Secure still redirects and comes back, and the return is now ours to handle
rather than the PSP's. And the settlement race widens - the browser can die
between confirming and the webhook landing - which is why the order is created
_before_ the handoff and settled _only_ by the webhook. The client's success
callback is a hint for the UI, never the record.
