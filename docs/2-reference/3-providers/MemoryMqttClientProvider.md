# MemoryMqttClientProvider

## Import

```typescript
import { MemoryMqttClientProvider } from "@alepha/mqtt";
```

## Overview

MQTT client on an in-process broker: no socket, no timing.

Selected by `AlephaMqtt` when `MQTT_URL` is unset, and in the browser and
on workerd. It is what the topic provider, `@alepha/sparkplug` and apps
test on. Its broker is a `MemoryMqttBroker`, one per container unless
shared with `useBroker()`:

```ts
const device = Alepha.create().with(AlephaMqtt);
const app = Alepha.create().with(AlephaMqtt);
app.inject(MemoryMqttClientProvider).useBroker(device.inject(MemoryMqttBroker));
```

`publish()` resolves once every subscriber's callbacks have run.
