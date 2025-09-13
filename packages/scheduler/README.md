# Alepha Scheduler

Schedule recurring tasks using cron expressions or fixed intervals.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/scheduler
```

## Module

Generic interface for scheduling tasks.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaScheduler } from "alepha/scheduler";

const alepha = Alepha.create()
	.with(AlephaScheduler);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

For more details, see the [Descriptors documentation](https://feunard.github.io/alepha/docs/descriptors).

#### $scheduler()

Scheduler descriptor.
