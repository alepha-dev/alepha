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

Default log level for the application.
	
	Default by environment:
	- dev = info
	- prod = info
	- test = error
	
	Levels are: "trace" | "debug" | "info" | "warn" | "error" | "silent"
	
	Level can be set for a specific module:
	
	@example
	LOG_LEVEL=my.module.name:debug,info # Set debug level for my.module.name and info for all other modules
	LOG_LEVEL=alepha:trace, info # Set trace level for all alepha modules and info for all other modules

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
