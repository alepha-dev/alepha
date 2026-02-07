# Alepha - Retry

## Installation

Part of the `alepha` package. Import from `alepha/retry`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.12.0 | node, bun, workerd, browser, expo|

Automatic retry with backoff.

**Features:**
- Retry configuration
- Exponential backoff
- Max retry limits
- Custom retry predicates

## API Reference

### Primitives

- [`$retry`](/docs/reference-primitives-$retry) — Creates a function that automatically retries a handler upon failure,

### Providers

- [`RetryProvider`](/docs/reference-providers-retryprovider) — Service for executing functions with automatic retry logic.
