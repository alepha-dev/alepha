# MqttJsClientProvider

## Import

```typescript
import { MqttJsClientProvider } from "@alepha/mqtt";
```

## Overview

MQTT client provider backed by the `mqtt` npm package (mqtt.js).

Selected by `AlephaMqtt` when `MQTT_URL` is set on Node or Bun. MQTT 5 by
default; `protocolVersion: 4` in the options atom speaks MQTT 3.1.1.

Resubscription after a reconnect is done here rather than by mqtt.js, so
every subscription keeps its Subscription Identifier and `connect()` can
wait for the SUBACKs before it resolves.
