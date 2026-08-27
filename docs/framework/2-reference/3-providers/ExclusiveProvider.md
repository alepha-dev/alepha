# ExclusiveProvider

## Import

```typescript
import { ExclusiveProvider } from "alepha/command";
```

## Overview

A machine-wide FIFO queue for CLI commands that must not run concurrently.

Deliberately not built on `alepha/lock`: the default `MemoryLockProvider` is
in-process, so two CLI processes would each hold their own and the feature
would silently protect nothing. `$lock`'s `wait` is also a race rather than a
queue, and its `maxDuration` doubles as both the lock TTL and the wait
timeout, which breaks on any command that runs longer than it.
