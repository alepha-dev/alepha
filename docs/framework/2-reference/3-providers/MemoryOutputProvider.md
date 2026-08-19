# MemoryOutputProvider

## Import

```typescript
import { MemoryOutputProvider } from "alepha/command";
```

## Overview

Captures command output instead of writing it to stdout.

Substitute it to assert on what a command produced:

```ts
const alepha = Alepha.create()
  .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });

const output = alepha.inject(MemoryOutputProvider);
expect(output.text).toContain("0.24.0");
```

Colour is stripped, matching what a caller piping the command would see -
the interesting case, and the one worth asserting against. Assertions do not
have to know which escape sequences a `ConsoleColorProvider` happened to
emit.

