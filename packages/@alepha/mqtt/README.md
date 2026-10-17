# Alepha @alepha/mqtt

An MQTT 5 client for Alepha: byte payloads, a Last Will settable by code,
reconnection, shared subscriptions dispatched by Subscription Identifier, and
an in-process memory broker for tests.

> Hand-written rather than generated. `yarn copy` generates a README from the
> module's `@module` block for **published** packages only, and this one is
> still `private`. It becomes generated the day it is published.

## Usage

```typescript
import { AlephaMqtt, MqttClientProvider } from "@alepha/mqtt";
import { Alepha } from "alepha";

const alepha = Alepha.create().with(AlephaMqtt);
const mqtt = alepha.inject(MqttClientProvider);
await alepha.start();

await mqtt.subscribe("plant/+/temperature", (message) => {
  console.log(message.topic, new TextDecoder().decode(message.payload));
});
await mqtt.publish("plant/line-1/temperature", "21.5", { qos: 1 });
```

`MQTT_URL` set (Node or Bun) selects mqtt.js; unset, the client runs on the
in-process memory broker.

The guide: `docs/1-guides/4-server/22-mqtt.md`.
