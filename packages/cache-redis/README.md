# Alepha Cache Redis

Redis implementation for the caching interface.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/cache-redis
```
## Module

```ts
import { Alepha, run } from "alepha";
import { AlephaCacheRedis } from "alepha/cache/redis";

const alepha = Alepha.create()
  .with(AlephaCacheRedis);

run(alepha);
```

Alepha Cache Redis Module

Plugin for Alepha Cache that provides Redis caching capabilities.

## API Reference
