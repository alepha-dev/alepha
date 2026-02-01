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

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $logger()

Create a logger.

`name` is optional, by default it will use the name of the service.

```ts
import { $logger } from "alepha";

class MyService {
	log = $logger();

  constructor() {
    this.log.info("Service initialized");
    // print something like '[23:45:53.326] INFO <app.MyService>: Service initialized'
  }
}
```

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `FORCE_COLOR` | text | - |  |
| `NO_COLOR` | text | - |  |
