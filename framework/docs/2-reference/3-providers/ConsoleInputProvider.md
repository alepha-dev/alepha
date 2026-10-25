# ConsoleInputProvider

## Import

```typescript
import { ConsoleInputProvider } from "alepha/command";
```

## Overview

What a command reads from stdin, as a seam a spec can substitute.

The one reader today is a flag value of `@-` (see `CliProvider`), which
takes the whole of stdin as the value. Reading `node:process` inline would
leave a spec two choices, both bad: pipe into its own test runner, or never
cover the refusals at all. Substitute `MemoryInputProvider` instead.

`process` is read inside the methods, never at module level: this module is
part of `alepha/command`, which a workerd bundle can reach, and a
module-level `process.stdin` throws there.
