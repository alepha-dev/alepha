# TableShippingQuoteProvider

## Import

```typescript
import { TableShippingQuoteProvider } from "@alepha/commerce/shipping";
```

## Overview

Answers the checkout's shipping question from the zone/rate tables.

This is the whole of the link between the two modules: `shipping` implements
an interface that `checkout` declares. The arrow points from the plugin to the
extension point, never the other way, so a consumer that imports only
`checkout` never learns these tables exist.
