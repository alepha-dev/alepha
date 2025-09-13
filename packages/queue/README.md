# Alepha Queue

A simple, powerful interface for message queueing systems.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/queue
```

## Module

Provides asynchronous message queuing and processing capabilities through declarative queue descriptors.

The queue module enables reliable background job processing and message passing using the `$queue` descriptor
on class properties. It supports schema validation, automatic retries, and multiple queue backends for
building scalable, decoupled applications with robust error handling.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaQueue } from "alepha/queue";

const alepha = Alepha.create()
	.with(AlephaQueue);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

For more details, see the [Descriptors documentation](https://feunard.github.io/alepha/docs/descriptors).

#### $consumer()

Consumer descriptor.

#### $queue()

Create a new queue.
