# ShellProvider

## Import

```typescript
import { ShellProvider } from "alepha/system";
```

## Overview

Abstract provider for executing shell commands and binaries.

Implementations:
- `NodeShellProvider` - Real shell execution using Node.js child_process
- `MemoryShellProvider` - In-memory mock for testing

