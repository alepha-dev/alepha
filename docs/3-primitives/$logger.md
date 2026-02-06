# $logger

> Create a logger.

## Import

```typescript
import { $logger } from "alepha/logger";
```

## Overview

Create a logger.

`name` is optional, by default it will use the name of the service.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No |  |

## Examples

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

