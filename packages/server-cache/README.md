# Alepha Server Cache

Adds ETag and Cache-Control headers to server responses.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/server-cache
```
## Module

# Alepha Server Cache Module

Plugin for Alepha Server that provides server-side caching capabilities.
It uses the Alepha Cache module to cache responses from server actions ($action).
It also provides a ETag-based cache invalidation mechanism.

```ts
import { Alepha } from "alepha";
import { $action } from "alepha/server";
import { AlephaServerCache } from "alepha/server/cache";

class ApiServer {
  hello = $action({
    cache: true,
    handler: () => "Hello, World!",
  });
}

const alepha = Alepha.create()
  .with(AlephaServerCache)
  .with(ApiServer);

run(alepha);
```
