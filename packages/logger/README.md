# Alepha Logger

A simple logger for Alepha applications

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/logger
```


## API Reference

### Descriptors

#### $logger()

Create a logger.

`name` is optional, by default it will use the name of the service.

```ts
import { $logger } from "@alepha/core";

class MyService {
	log = $logger();

  constructor() {
    this.log.info("Service initialized");
    // print something like '[23:45:53.326] INFO <app.MyService>: Service initialized'
  }
}
```
