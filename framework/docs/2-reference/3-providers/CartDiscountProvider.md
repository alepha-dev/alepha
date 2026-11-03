# CartDiscountProvider

## Import

```typescript
import { CartDiscountProvider } from "@alepha/commerce/cart";
```

## Overview

Where a cart asks whether it earned a discount.

Most consumers of the cart have no promotions, and a hard dependency would
put two promotion tables in their migrations, so `@alepha/commerce/promotions`
plugs in here.

### Why a slot and not a substitution

For the reason `OrderDocumentsProvider` is one: `shipping` substitutes into
the checkout, a module wires its services as it registers, and two plugins
that both substitute cannot be ordered. The second gets
`TooLateSubstitutionError`. Nothing is substituted here, so the order the
modules are wired in cannot matter.
