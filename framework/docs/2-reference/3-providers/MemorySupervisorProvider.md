# MemorySupervisorProvider

## Import

```typescript
import { MemorySupervisorProvider } from "@alepha/desktop/shell";
```

## Overview

A scripted supervisor for specs. `crash` plays the server dying
while the window is open: it terminates the attached memory window, as the
real supervisor does from its own thread.
