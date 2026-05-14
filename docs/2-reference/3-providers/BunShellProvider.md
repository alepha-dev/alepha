# BunShellProvider

## Import

```typescript
import { BunShellProvider } from "alepha/system";
```

## Overview

Bun implementation of ShellProvider.

Executes shell commands using Bun's native `Bun.spawn` and `Bun.which`,
skipping the `node:child_process` compatibility layer for better performance.

Inherits executable resolution (`node_modules/.bin` walk) and command parsing
from `NodeShellProvider`.

