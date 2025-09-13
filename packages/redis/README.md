# Alepha Redis

A Redis client for caching, pub/sub, and more.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Redis client provider for Alepha applications.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaRedis } from "alepha/redis";

const alepha = Alepha.create()
	.with(AlephaRedis);

run(alepha);
```

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

#### RedisProvider

Redis client provider.
