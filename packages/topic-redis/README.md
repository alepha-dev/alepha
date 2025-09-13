# Alepha Topic Redis

Redis implementation for the pub/sub messaging interface.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/topic-redis
```

## Module

Plugin for Alepha Topic that provides Redis pub/sub capabilities.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaTopicRedis } from "alepha/topic/redis";

const alepha = Alepha.create()
	.with(AlephaTopicRedis);

run(alepha);
```
