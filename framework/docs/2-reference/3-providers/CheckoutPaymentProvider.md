# CheckoutPaymentProvider

## Import

```typescript
import { CheckoutPaymentProvider } from "@alepha/commerce/checkout";
```

## Overview

Bridges a checkout session to a payment rail.

Sits above `alepha/api/payments` rather than replacing it: that module owns
the intent lifecycle, the webhooks and the PSP adapters. This one only knows
how to turn "this checkout owes 89,00 €" into something a browser can act on.
