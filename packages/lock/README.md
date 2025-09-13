# Alepha Lock

Distributed mutex and semaphore for resource locking and synchronization.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/lock
```

## Module

Lock a resource for a certain period of time.

This module provides a memory implementation of the lock provider.
You probably want to use an implementation like RedisLockProvider for distributed systems.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaLock } from "alepha/lock";

const alepha = Alepha.create()
	.with(AlephaLock);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

#### $lock()

Lock descriptor

Make sure that only one instance of the handler is running at a time.

When connected to a remote store, the lock is shared across all processes.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

#### MemoryLockProvider

A simple in-memory store provider.
