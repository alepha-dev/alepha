# InstanceLockProvider

## Import

```typescript
import { InstanceLockProvider } from "@alepha/desktop/shell";
```

## Overview

One running instance per app identifier.

Taken by the shell before the server Worker starts, so before any secret is
generated or any database opened: a second launch refuses rather than
racing the first one's writes. The lock dies with the process, crash
included, so a crash never leaves the app unable to start.
