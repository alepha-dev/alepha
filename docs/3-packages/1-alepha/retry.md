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

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $retry()

Creates a function that automatically retries a handler upon failure,
with support for exponential backoff, max duration, and cancellation.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### RetryProvider

Service for executing functions with automatic retry logic.
Supports exponential backoff, max duration, conditional retries, and cancellation.
