# RedirectCheckoutPayment

## Import

```typescript
import { RedirectCheckoutPayment } from "@alepha/commerce/checkout";
```

## Overview

Takes payment by sending the browser to the PSP's hosted page.

The default, and the reason it is the default: it is the only handoff every
PSP supports, it needs no new adapter code, and it keeps the application out
of PCI scope and out of the 3-D Secure retry logic. The customer leaves the
site for one screen and comes back.

An embedded implementation replaces this by substitution:

```ts
alepha.with({
  provide: CheckoutPaymentProvider,
  use: EmbeddedCheckoutPayment,
});
```
