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
- Duration parsing (ISO 8601, human-readable)
- Timezone support
- Dayjs integration

## API Reference

### Primitives

- [`$debounce`](/docs/reference-primitives-$debounce) — Middleware that coalesces concurrent calls with the same key into a single handler execution.
- [`$interval`](/docs/reference-primitives-$interval) — Run a function periodically.
- [`$throttle`](/docs/reference-primitives-$throttle) — Middleware that rate-controls handler execution using a token bucket.
- [`$timeout`](/docs/reference-primitives-$timeout) — Middleware that aborts handler execution if it exceeds a duration limit.

### Providers

- [`DateTime`](/docs/reference-providers-datetime) — Immutable wrapper around the underlying date-time engine.
