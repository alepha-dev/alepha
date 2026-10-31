# ShippingQuoteProvider

## Import

```typescript
import { ShippingQuoteProvider } from "@alepha/commerce/checkout";
```

## Overview

Where the checkout asks what delivery costs.

### Why this indirection exists

`checkout` must not depend on `@alepha/commerce/shipping`. Ticketing has a
cart and a checkout and ships _nothing_ - a hard dependency would put two
shipping tables into its migrations forever. So the checkout asks an
abstraction, and the shipping module answers it by substitution.

The default answers "no options", which is the correct behaviour for a shop
that sells only downloads: delivery costs nothing and has no name.
