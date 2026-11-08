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

The envelope is `{ headers, payload }`. `headers` carries message
metadata without a format break: today the producer's `traceparent`, when
a span is active, so the consumer's root links back to it. A consumer
that predates a header ignores it.
