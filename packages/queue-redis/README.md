# Alepha Queue Redis

Redis implementation for the message queueing system.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/queue-redis
```
## Module

```ts
import { Alepha, run } from "alepha";
import { AlephaQueueRedis } from "alepha/queue/redis";

const alepha = Alepha.create()
  .with(AlephaQueueRedis);

run(alepha);
```

Alepha Queue Redis Module

Plugin for Alepha Queue that provides Redis queue capabilities.

## API Reference
