# ProductKindRegistry

## Import

```typescript
import { ProductKindRegistry } from "alepha";
```

## Overview

Extension point letting any module teach the catalog a new kind of sellable
thing.

A module adds its handler from its `register` hook:

```ts
$module({
  name: "myapp.pos",
  services: [WalletTopUpHandler],
  register: (alepha) => {
    alepha.inject(ProductKindRegistry).add(alepha.inject(WalletTopUpHandler));
  },
});
```

Same shape as `RootComponentsProvider` in `alepha/react/router` - a plain
collection that modules contribute to, resolved at use time.
