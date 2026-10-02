# DevLogStoreProvider

## Import

```typescript
import { DevLogStoreProvider } from "alepha";
```

## Overview

The devtools log buffer, and the part of it that outlives the process.

Logs used to live only in `MemoryDestinationProvider`, which made every dev
restart throw them away. That is backwards: the restart is usually caused by
the very thing you were trying to read, so the crash that triggered it was
the first casualty. This provider keeps the same in-memory buffer as the live
store and mirrors it to an append-only JSONL file, then loads the tail back
on the next boot with a synthetic marker separating the two runs.

Restored entries are held in `history`, apart from the live buffer, for two
reasons. Ordering needs no hook choreography, since history is always
prepended regardless of what the current run has already logged. And the
ring eviction in `MemoryDestinationProvider` keeps applying to the live run
alone, so a busy session cannot silently evict the crash you restarted to
read.

Dev only. `AlephaDevtools` refuses to register in production, so nothing here
can turn into a production log sink.
