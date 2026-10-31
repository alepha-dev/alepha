# AddressRulesProvider

## Import

```typescript
import { AddressRulesProvider } from "@alepha/commerce/checkout";
```

## Overview

Per-country address rules for the EU.

### Why this is a provider and not a constant

The day the shop sells to Switzerland or the UK, the list needs one more
entry - and editing a framework package to add a country you sell to is
absurd. Substituting the provider is the supported answer:

```ts
class MyRules extends AddressRulesProvider {
  override rules() {
    return {
      ...super.rules(),
      CH: { name: "Suisse", postalCode: /^\d{4}$/, example: "8001" },
    };
  }
}
alepha.with({ provide: AddressRulesProvider, use: MyRules });
```

The patterns are deliberately shape-only. Validating that a postcode _exists_
requires a carrier's address database, which is a paid API and a different
concern; what this catches is the typo and the wrong-country paste, which is
most of what goes wrong.
