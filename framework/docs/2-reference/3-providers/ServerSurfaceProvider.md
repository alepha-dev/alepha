# ServerSurfaceProvider

## Import

```typescript
import { ServerSurfaceProvider } from "alepha/server";
```

## Overview

The HTTP surface of the classes a module declared and has not created
(#Q3403).

With a build list, a pure controller is declared at registration and not
created. This provider fills the router from the list instead: one
placeholder per route of a declared class, which creates the class on the
first request that matches it. The class's own `$action.onInit` then
registers the real route in the placeholder's place, and the request is
dispatched to it. A cron, a queue message or any other event creates no
declared class.

Without a list nothing is declared, and this provider does nothing.
