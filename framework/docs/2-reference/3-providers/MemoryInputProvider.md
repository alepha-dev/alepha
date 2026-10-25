# MemoryInputProvider

## Import

```typescript
import { MemoryInputProvider } from "alepha/command";
```

## Overview

Stdin from memory, for specs.

```ts
const alepha = Alepha.create().with({
  provide: ConsoleInputProvider,
  use: MemoryInputProvider,
});

const input = alepha.inject(MemoryInputProvider);
input.content = "## Body\n";
```

Starts as a pipe that carries nothing, which is what an agent's shell tool
looks like when nothing was piped in. Set `tty` to stand in for a terminal.
