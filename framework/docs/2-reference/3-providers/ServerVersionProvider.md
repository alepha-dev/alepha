# ServerVersionProvider

## Import

```typescript
import { ServerVersionProvider } from "alepha/server";
```

## Overview

Registers `GET /version`, answering "what is running here?".

Part of `AlephaServer` rather than opt-in, for the same reason `/health` is:
every app wants it and every app was writing it by hand. The values come
from `Alepha.meta`, resolved once at build time, so this route costs
nothing to serve and cannot disagree with what the client bundle shows.

**Separate from `/health` on purpose.** They answer different questions and
have opposite caching rules: this is immutable for the life of a deploy,
while readiness must never be cached. `/health` is also polled on a loop by
supervisors, so its payload stays minimal and its schema stays a frozen
contract. And an app that would rather not say what it is running can turn
this off without turning off readiness, which a shared route could not offer.

Not a security concern by default: it discloses a version, a commit and a
build date, which say nothing an unauthorized caller can act on. An app that
disagrees has `versionOptions` - `expose` to withhold fields, `enabled`
to remove the route.
