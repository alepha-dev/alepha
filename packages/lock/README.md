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

## API Reference

### Descriptors

#### $lock()

Lock descriptor

Make sure that only one instance of the handler is running at a time.

When connected to a remote store, the lock is shared across all processes.

### Providers

#### MemoryLockProvider

A simple in-memory store provider.
