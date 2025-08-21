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

## Module

Minimalist logger module for Alepha.

It offers a global logger interface (info, warn, ...) via the `$logger` descriptor.

```ts
import { $logger } from "@alepha/logger";

class App {
  log = $logger();
}
```

### Formatting and Destinations

`AlephaLogger` is **extensible**, destinations and formatters can be added or replaced.

Default log destinations are:
- ConsoleDestinationProvider: logs to the console.
- MemoryDestinationProvider: stores logs in memory for later retrieval.

Default log formatters are:
- JsonFormatterProvider: formats logs as JSON.
- SimpleFormatterProvider: formats logs as simple text (with colors when possible).
- RawFormatterProvider: formats logs as raw text without any formatting.

### Log Level

You can configure the log level and format via environment variables:

- `LOG_LEVEL`: Sets the default log level for the application.
- `LOG_FORMAT`: Sets the default log format for the application.

```bash
LOG_LEVEL=debug LOG_FORMAT=json node src/index.ts
```

Log level is also available in the state as `logLevel`, which can be used to dynamically change the log level at runtime.
```ts
alepha.state("logLevel", "debug");
```

Log level is $module aware, meaning you can set different log levels for different modules.
For example, you can set `LOG_LEVEL=my.module.name:debug,info` to set the log level to debug for `my.module.name` and info for all other modules.

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
	    // print something like '[23:45:53.326] INFO <app.App>: App is ready!'
		this.log.info("Service initialized");
	}
}
```
