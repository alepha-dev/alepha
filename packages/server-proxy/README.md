# Alepha Server Proxy

Reverse-proxies incoming requests to other backend services.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/server-proxy
```

## Module

Plugin for Alepha that provides a proxy server functionality.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaServerProxy } from "alepha/server/proxy";

const alepha = Alepha.create()
	.with(AlephaServerProxy);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

#### $proxy()

Creates a proxy descriptor to forward requests to another server.

```ts
import { $proxy } from "@alepha/server-proxy";

class App {
  api = $proxy({ path: "/api", target: "https://api.example.com" });
}
```
