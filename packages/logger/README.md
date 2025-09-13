# Alepha Logger

A simple logger for Alepha applications

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```


## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

For more details, see the [Descriptors documentation](https://feunard.github.io/alepha/docs/descriptors).

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
