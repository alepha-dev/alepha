# Alepha - Logger

## Installation

Part of the `alepha` package. Import from `alepha/logger`.

```bash
npm install alepha
```

## Overview

Configurable logging with multiple outputs.

**Features:**

- Global logger access
- JSON format
- Pretty colored output
- Compact CLI format
- Raw text format
- Console destination
- Memory destination (for devtools)
- Custom handlers
- Configuration via `LOG_LEVEL`, `LOG_FORMAT`, and `DEBUG`

## API Reference

### Primitives

- [`$logger`](/docs/reference-primitives-$logger) - Create a logger.

### Providers

- [`CliFormatterProvider`](/docs/reference-providers-cliformatterprovider) - Compact formatter for CLI output.
- [`LogBufferProvider`](/docs/reference-providers-logbufferprovider) - Access to the log buffer of the current execution context.
