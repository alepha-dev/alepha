# AppStateProvider

## Import

```typescript
import { AppStateProvider } from "@alepha/capacitor/core";
```

## Overview

Whether the app is in the foreground, and the event when that changes.

Emits `capacitor:app:state` with `{ active }` on every change. The web
implementation (this class) follows the document's visibility; the native
one follows `@capacitor/app`. Both start listening when the container
starts and stop when it stops.
