# $retry

> Creates a function that automatically retries a handler upon failure,

## Import

```typescript
import { $retry } from "alepha/retry";
```

## Overview

Creates a function that automatically retries a handler upon failure,
with support for exponential backoff, max duration, and cancellation.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `handler` | `T` | Yes | The function to retry. |
| `max` | `number` | No | The maximum number of attempts. |
| `backoff` | `number \| RetryBackoffOptions` | No | The backoff strategy for delays between retries |
| `maxDuration` | `DurationLike` | No | An overall time limit for all retry attempts combined |
| `when` | `Object` | No | A function that determines if a retry should be attempted based on the error. |
| `onError` | `Object` | No | A custom callback for when a retry attempt fails |
| `signal` | `AbortSignal` | No | An AbortSignal to allow for external cancellation of the retry loop. |

