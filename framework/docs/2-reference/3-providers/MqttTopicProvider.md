# MqttTopicProvider

## Import

```typescript
import { MqttTopicProvider } from "@alepha/mqtt/topic";
```

## Overview

Topics over MQTT, for device and integration topics.

**Opt in per topic, never the app's `TopicProvider`.** The framework's own
topics (`websocket:broadcast`, `parameter:sync`) stay on memory or Redis;
a device topic names this provider:

```ts
status = $topic({
  name: "mcs/v1/{site}/{device}/status",
  provider: MqttTopicProvider,
  schema: {
    params: z.object({ site: z.text(), device: z.text() }),
    payload: deviceStatusSchema,
  },
  mqtt: { qos: 1, share: "mcs" },
});
```

- **Topic names are exact**: no prefix unless the `prefix` atom sets one.
- **Params are `+` wildcards**: a subscriber on a templated name receives
  the params of the topic each message arrived on.
- **The wire format is the payload alone**, UTF-8 JSON, which is what a
  device publishes; not the `{ payload }` envelope of memory and Redis.
- **QoS 1 by default.** At QoS 0 an awaited publish resolves on the
  socket write and proves nothing; QoS 1 makes the await mean what the
  memory and Redis providers make it mean. QoS 1 is at-least-once, so a
  handler on a device topic must be idempotent.

It runs on whichever `MqttClientProvider` `AlephaMqtt` selects: the memory
broker when `MQTT_URL` is unset, which is what tests use.
