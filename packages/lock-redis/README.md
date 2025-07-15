# Alepha Lock Redis

Redis implementation for the distributed locking mechanism.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/lock-redis
```
## Module

```ts
import { Alepha, run } from "alepha";
import { AlephaLockRedis } from "alepha/lock/redis";

const alepha = Alepha.create()
  .with(AlephaLockRedis);

run(alepha);
```

Alepha Lock Redis Module

Plugin for Alepha that provides a locking mechanism.

## API Reference
