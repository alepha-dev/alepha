# MemoryUpdaterAdapter

## Import

```typescript
import { MemoryUpdaterAdapter } from "@alepha/capacitor/ota";
```

## Overview

The pinned updater's behaviour, in memory, for specs of the real
`OtaProvider`: the semantics measured on the simulator and the emulator
(#Q2524), Android's where the platforms differ.

- `check()` answers what a spec queued in `answers`, decoded as the
  plugin decodes it (`session_key` into `sessionKey`);
- `download()` refuses what the plugin refuses (no session key, no
  checksum, a URL in `broken`) and stores a `pending` bundle;
- `setNext()` of the current successful bundle is a no-op, as on Android;
- `background` applies the next bundle unless it is marked failed;
  `rollBack` is the updater's own revert of an unacknowledged one.
