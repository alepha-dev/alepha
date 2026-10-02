# MultipartCapProvider

## Import

```typescript
import { MultipartCapProvider } from "alepha/server/multipart";
```

## Overview

Decides how many bytes a given request is allowed to carry.

**It has no opinion of its own**, and that is deliberate: a framework-wide
ceiling that anything could raise would be a ceiling in name only. Modules
add a resolver for the routes they own - `alepha/api/files` does exactly
that, mapping the targeted `$storage` bucket to its `maxSize`.

```ts
alepha.inject(MultipartCapProvider).use((request, route) => …);
```

A registry rather than a substitutable provider, because substitution has an
ordering constraint this cannot satisfy: whoever wants to answer usually
loads _after_ the server that reads the answer, and by then the provider is
already resolved. Adding to a list works whenever it happens.

⚠️ **This is a security surface, not a convenience.** A resolver can raise a
limit, so whatever it keys on is chosen by the caller: a query parameter is
attacker-controlled, and a resolver that answers for _every_ route lets any
request claim the largest budget the app declares anywhere. Answer
`undefined` for routes you do not own.

⚠️ And a raised limit is only safe on a path that streams. `$secure` runs
after the body hook, so on a buffering path the budget is reachable before
authentication - a bigger number there is a cheaper denial of service, not a
feature.
