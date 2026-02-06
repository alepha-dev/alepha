# Alepha - Batch

## Installation

Part of the `alepha` package. Import from `alepha/batch`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.8.0 | node, bun|

Batch accumulation and processing.

**Features:**
- Batch accumulator with handler
- Configurable batch size
- Time-based triggers
- Status tracking

## API Reference

### Primitives

- [`$batch`](/docs/primitives-$batch) — Creates a batch processing primitive for efficient grouping and processing of multiple operations.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### BatchProvider

Service for batch processing operations.
Provides methods to manage batches of items with automatic flushing based on size or time.
