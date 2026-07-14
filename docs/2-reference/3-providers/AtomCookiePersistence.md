# AtomCookiePersistence

## Import

```typescript
import { AtomCookiePersistence } from "alepha/server/cookies";
```

## Overview

Binds every atom declared with `persist: "cookie"` to an HTTP cookie.

- `server:onRequest` — seeds the request-scoped state from the cookie, so
  SSR renders with the persisted value.
- `state:mutate` — writes the new value back as a Set-Cookie header.
- `state:register` — an atom registering lazily *during* a request (first
  touched by an SSR render, after `server:onRequest` already ran) reads
  its cookie right away, so that render still sees the persisted value.

Atoms are resolved from the `StateManager` registry
(`alepha.store.listAtoms()`) on every request and every mutation, never
from a map built up from `state:register` events. That event fires exactly
once per atom and is never replayed, while `$module.register()` registers
`atoms[]` BEFORE it wires `imports[]` and injects `services[]` — so the
documented `$module({ atoms, imports: [AlephaServerCookies], services })`
shape registers every atom before this provider exists. An event-sourced
map would stay empty forever there, making `persist: "cookie"` a silent
no-op in both directions. Reading the registry on demand is
order-independent.

The cookie is named after the atom key, lives 365 days, SameSite=lax,
path "/". For custom cookie options (encryption, signing, custom TTL),
declare an explicit `$cookie({ key: atom.key, ... })` binding instead.

