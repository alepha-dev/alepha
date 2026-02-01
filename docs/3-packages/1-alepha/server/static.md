# Alepha - Server Static

## Installation

Part of the `alepha` package. Import from `alepha/server/static`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.3.0 | node, bun|

Static file serving.

**Features:**
- Serve static files from directory

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $serve()

Create a new static file handler.
