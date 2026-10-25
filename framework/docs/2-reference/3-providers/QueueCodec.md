# QueueCodec

## Import

```typescript
import { QueueCodec } from "alepha/queue";
```

## Overview

Owns the on-the-wire shape of a queue message.

Producers (`QueueProvider` callers) encode, the worker loop decodes.
Keeping both halves here means the envelope has exactly one definition -
it used to be split between the `$queue` primitive and `WorkerProvider`,
so a change to one side could silently corrupt payloads.

The envelope is `{ headers, payload }`. `headers` is currently always
empty and exists so message metadata can be added without a format break.
