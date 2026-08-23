# Alepha - Datetime

## Installation

Part of the `alepha` package. Import from `alepha/datetime`.

```bash
npm install alepha
```

## Overview

Date and time operations.

**Features:**

- Recurring interval definitions
- Duration helpers (numbers, `[n, unit]` tuples and `Duration` objects)
- Timezone support
- Dayjs integration

## API Reference

### Primitives

- [`$debounce`](/docs/reference-primitives-$debounce) - Middleware that coalesces concurrent calls with the same key into a single handler execution.
- [`$interval`](/docs/reference-primitives-$interval) - Run a function periodically.
- [`$throttle`](/docs/reference-primitives-$throttle) - Middleware that rate-controls handler execution using a token bucket.
- [`$timeout`](/docs/reference-primitives-$timeout) - Middleware that aborts handler execution if it exceeds a duration limit.

### Providers

- [`DateTimeProvider`](/docs/reference-providers-datetimeprovider) - The injectable clock. Every service reads time through it - `nowMillis()`,
