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

```ts
import { Alepha, run } from "alepha";
import { AlephaQueue } from "alepha/queue";

const alepha = Alepha.create()
  .with(AlephaQueue);

run(alepha);
```

Alepha Queue Module

Generic interface for queueing.
Gives you the ability to create queues and consumers.
This module provides only a memory implementation of the queue provider.

## API Reference

### Descriptors

#### $consumer()

Consumer descriptor.

#### $queue()

Create a new queue.
