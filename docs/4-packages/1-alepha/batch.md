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

- [`$batch`](/docs/reference-primitives-$batch) — Creates a batch processing primitive for efficient grouping and processing of multiple operations.

### Providers

- [`BatchProvider`](/docs/reference-providers-batchprovider) — Service for batch processing operations.
