# Alepha - Datetime

## Installation

Part of the `alepha` package. Import from `alepha/datetime`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.10.0 | node, bun, workerd, browser, expo|

Date and time operations.

**Features:**
- Recurring interval definitions
- Duration parsing (ISO 8601, human-readable)
- Timezone support
- Dayjs integration

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $interval()

Run a function periodically.
It uses the `setInterval` internally.
It starts by default when the context starts and stops when the context stops.
