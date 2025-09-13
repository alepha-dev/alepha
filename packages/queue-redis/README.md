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

Plugin for Alepha Queue that provides Redis queue capabilities.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaQueueRedis } from "alepha/queue/redis";

const alepha = Alepha.create()
	.with(AlephaQueueRedis);

run(alepha);
```
