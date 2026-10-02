# MemoryShellProvider

## Import

```typescript
import { MemoryShellProvider } from "alepha/system";
```

## Overview

In-memory implementation of ShellProvider for testing.

Records all commands that would be executed without actually running them.
Can be configured to return specific outputs or throw errors for testing.
