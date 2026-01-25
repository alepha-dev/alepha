# Alepha - Batch

## Installation

Part of the `alepha` package. Import from `alepha/batch`.

```bash
npm install alepha
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Batch accumulation and processing.

**Features:**
- Batch accumulator with handler
- Configurable batch size
- Time-based triggers
- Status tracking

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $batch()

Creates a batch processing primitive for efficient grouping and processing of multiple operations.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### BatchProvider

Service for batch processing operations.
Provides methods to manage batches of items with automatic flushing based on size or time.
