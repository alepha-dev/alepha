# Alepha - Retry

## Installation

Part of the `alepha` package. Import from `alepha/retry`.

```bash
npm install alepha
```

## Overview

Automatic retry with backoff.

**Features:**
- Retry configuration
- Exponential backoff
- Max retry limits
- Custom retry predicates

## API Reference

### Primitives

- [`$retry`](/docs/reference-primitives-$retry) - Retry middleware for `use` arrays in `$action`, `$job`, `$page`, `$pipeline`.

### Providers

- [`RetryProvider`](/docs/reference-providers-retryprovider) - Service for executing functions with automatic retry logic.
