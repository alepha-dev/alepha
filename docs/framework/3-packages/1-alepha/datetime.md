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

- [`$interval`](/docs/reference-primitives-$interval) - Run a function periodically.

### Providers

- [`DateTimeProvider`](/docs/reference-providers-datetimeprovider) - The injectable clock. Every service reads time through it - `nowMillis()`,
