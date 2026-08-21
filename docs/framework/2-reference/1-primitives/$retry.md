# $retry

## Import

```typescript
import { $retry } from "alepha/retry";
```

## Overview

Retry middleware for `use` arrays in `$action`, `$job`, `$page`, `$pipeline`.

Retries the handler on failure with configurable backoff, max attempts, and
conditional retry via `when`. Aborts on application shutdown.

```ts
processOrder = $action({
  use: [$retry({ max: 3, backoff: { initial: 500 } })],
  handler: async ({ body }) => { ... },
});
```

## Options

| Option        | Type                            | Required | Description                                                                   |
| ------------- | ------------------------------- | -------- | ----------------------------------------------------------------------------- |
| `max`         | `number`                        | No       | The maximum number of attempts.                                               |
| `backoff`     | `number \| RetryBackoffOptions` | No       | The backoff strategy for delays between retries.                              |
| `maxDuration` | `DurationLike`                  | No       | An overall time limit for all retry attempts combined.                        |
| `when`        | `Object`                        | No       | A function that determines if a retry should be attempted based on the error. |
| `onError`     | `Object`                        | No       | A custom callback for when a retry attempt fails.                             |
| `signal`      | `AbortSignal`                   | No       | An AbortSignal to allow for external cancellation of the retry loop.          |
