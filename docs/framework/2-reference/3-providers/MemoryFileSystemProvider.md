# MemoryFileSystemProvider

## Import

```typescript
import { MemoryFileSystemProvider } from "alepha/system";
```

## Overview

In-memory implementation of FileSystemProvider for testing.

This provider stores all files and directories in memory, making it ideal for
unit tests that need to verify file operations without touching the real file system.

One deliberate looseness versus the node provider: `writeFile` succeeds
without its parent directories existing (and registers them implicitly),
so tests can seed fixtures in one call. Everything else follows the
contract pinned by `fileSystemContract.spec.ts`.

