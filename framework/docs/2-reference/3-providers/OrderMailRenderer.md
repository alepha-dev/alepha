# OrderMailRenderer

## Import

```typescript
import { OrderMailRenderer } from "@alepha/commerce/notifications";
```

## Overview

Writes the customer-facing order emails.

Abstract because these two messages are the most brand-sensitive text a shop
sends. The default below is deliberately plain prose in the shop's language,
from `CommerceTexts`: correct, complete, and obviously meant to be replaced:

```ts
alepha.with({ provide: OrderMailRenderer, use: AtelierAuroreMails });
```
