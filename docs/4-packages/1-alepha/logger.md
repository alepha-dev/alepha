# Alepha - Logger

## Installation

Part of the `alepha` package. Import from `alepha/logger`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.5.0 | node, bun, workerd, browser, expo|

Configurable logging with multiple outputs.

**Features:**
- Global logger access
- JSON format
- Pretty colored output
- Raw text format
- Console destination
- Memory destination (for devtools)
- Custom handlers
- Configuration via `LOG_LEVEL` and `LOG_FORMAT`

## API Reference

### Primitives

- [`$logger`](/docs/primitives-$logger) — Create a logger.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `FORCE_COLOR` | text | - |  |
| `NO_COLOR` | text | - |  |
