# Alepha - Server Cache

## Installation

Part of the `alepha` package. Import from `alepha/server/cache`.

```bash
npm install alepha
```

## Overview

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

