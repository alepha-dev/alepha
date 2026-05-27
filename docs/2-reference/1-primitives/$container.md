# $container

## Import

```typescript
import { $container } from "alepha/container";
```

## Overview

`$container` — typed RPC client to a containerized Alepha app.

Returns a typed Proxy whose method calls map 1:1 to the target
controller's `$action` endpoints. The wire format mirrors what a
normal Alepha server exposes (`POST /api/<method>` with a JSON body),
so the container is literally a tiny Alepha worker.

Transport is owned by the active {@link ContainerProvider}:
- `target=cloudflare` → `CloudflareContainerProvider` routes through
  the Containers binding (`env.<NAME>.getContainer(...).fetch()`).
- Node (with `url` set) → `NodeContainerProvider` uses plain
  `fetch()` against the configured URL.

Build-time, `BuildCloudflareTask.enhanceContainers` walks
`alepha.primitives($container)` to emit the matching `wrangler.jsonc`
entries and Durable Object class declarations into
`main.cloudflare.js`.

## Examples

```ts
import { $container } from "alepha/container";
import type { RocketController } from "@alepha/rocket";

class DeployService {
  rocket = $container<RocketController>({
    image: "alepha/rocket:latest",
    port: 3000,
    sleepAfter: "15m",
  });

  async deploy() {
    return this.rocket.createJob({ body: { op: "up" } });
  }
}
```

