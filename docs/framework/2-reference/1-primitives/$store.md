# $store

## Import

```typescript
import { $store } from "alepha";
```

## Overview

Reads a value out of the application store from a class property.

The declarative counterpart of `alepha.store.get(target)` - same store, same
operation, expressed as a class member instead of an imperative call. The
property is reactive: it re-reads on every access, so a mutation made
elsewhere is visible immediately.

Accepts either side of the state model:

- an `Atom` - read from the store, and registered on first use if it
  was not already
- a `Computed` - derived from its dependencies on every read. Computed
  values are never stored, so nothing is registered.

**Use cases**: global state, configuration, sharing data between services,
reading a derived value without wiring its dependencies by hand.

## Examples

Reading an atom

```ts
const userState = $atom({
  name: "user.state",
  schema: z.object({ name: z.text(), role: z.text() }),
  default: { name: "", role: "guest" },
});

class UserService {
  user = $store(userState);

  greet() {
    return `Hello ${this.user.name}!`;
  }
}
```

Reading a computed

```ts
const cartTotal = $computed({
  name: "cart.total",
  deps: [cartAtom],
  get: (cart) => cart.items.reduce((sum, it) => sum + it.price, 0),
});

class CheckoutService {
  total = $store(cartTotal); // number, re-derived on every read
}
```
