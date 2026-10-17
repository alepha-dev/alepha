# MQTT

`@alepha/mqtt` is an MQTT 5 client: byte payloads, a Last Will you can set
by code, reconnection, and shared subscriptions. Devices, gateways and
brokers speak MQTT; this is how an Alepha server talks to them.

```typescript check
import { AlephaMqtt, MqttClientProvider } from "@alepha/mqtt";
```

## Connecting

Register the module and set `MQTT_URL`:

```bash
MQTT_URL=mqtt://broker.example.com:1883
```

With `MQTT_URL` set (Node or Bun), the client is `MqttJsClientProvider`, on
[mqtt.js](https://github.com/mqttjs/MQTT.js). Without it, and always in the
browser and on Cloudflare Workers, it is `MemoryMqttClientProvider`, an
in-process broker: there is no default URL, so an app never points at a
broker that is not there. `mqtts://`, `ws://` and `wss://` work as they do in
mqtt.js.

The client connects on `start` and disconnects on `stop`. Everything else is
the `mqttOptions` atom:

```typescript check
import { AlephaMqtt, mqttOptions } from "@alepha/mqtt";
import { Alepha } from "alepha";

const alepha = Alepha.create().with(AlephaMqtt);

alepha.set(mqttOptions, {
  clientId: "gateway-7",
  protocolVersion: 5,
  keepalive: 60,
  lazy: false,
  reconnectPeriod: 5_000,
  username: "gateway",
  password: "s3cret",
  // Anything else mqtt.js accepts (`ca`, `cert`, `key` for mutual TLS),
  // merged last.
  connect: { rejectUnauthorized: true },
});
```

`protocolVersion: 4` speaks MQTT 3.1.1, for a broker that has nothing newer.
`lazy: true` defers the connection to the first publish or subscribe.

## Publishing and subscribing

```typescript check
import { MqttClientProvider } from "@alepha/mqtt";
import { $hook, $inject } from "alepha";

class Gateway {
  mqtt = $inject(MqttClientProvider);

  onStart = $hook({
    on: "start",
    handler: async () => {
      await this.mqtt.subscribe(
        "plant/+/temperature",
        (message) => {
          const celsius = Number(new TextDecoder().decode(message.payload));
          console.log(message.topic, celsius);
        },
        { qos: 1 },
      );

      await this.mqtt.publish("plant/line-1/command", "start", { qos: 1 });
    },
  });
}
```

- **Payloads are bytes.** `publish` takes a `string` or a `Uint8Array`, and
  a callback receives `payload` as a `Uint8Array`: decode JSON yourself, or
  hand protobuf bytes straight to their decoder.
- **Awaits mean something.** `subscribe` resolves on the broker's SUBACK, so
  a message published after it cannot be missed. At QoS 1 or 2, `publish`
  resolves on the broker's acknowledgement; at QoS 0 (the default) only on
  the write.
- **Wildcards**: `+` matches one level, `#` the rest. `message.topic` is the
  topic the message was published to.
- **Retained**: `{ retain: true }` stores the message on the broker for
  every later subscriber (`message.retain` is `true` on that delivery), and
  an empty retained payload clears it.
- `subscribe` resolves to a function that removes that one callback.
  Callbacks on the same filter share one broker subscription, which goes with
  the last of them.

### Shared subscriptions

Several instances of one app, each subscribed to `orders/+`, all receive
every order. Subscribe to `$share/<group>/orders/+` instead and the broker
hands each message to one member of the group:

```typescript
await this.mqtt.subscribe("$share/billing/orders/+", handle, { qos: 1 });
```

A member is a client connection: every callback this instance holds on that
filter runs for the copy the broker gives it. Shared subscriptions need
MQTT 5 and are refused under `protocolVersion: 4`.

Each subscription carries its own MQTT 5 Subscription Identifier, and a
message reaches only the subscriptions it was delivered for. So an instance
holding `$share/billing/orders/+` and a plain `orders/+` runs each callback
once per message it was meant to get, never the group's twice.

## The Last Will

A will is what the broker publishes when the client disappears without a
DISCONNECT: a crash, a cut cable, a lost keepalive. The simple case is the
atom:

```typescript
alepha.set(mqttOptions, {
  ...alepha.get(mqttOptions),
  will: {
    topic: "gateways/gateway-7/online",
    payload: "false",
    qos: 1,
    retain: true,
  },
});
```

When the will is bytes, or changes between connections, set it by code:

```typescript
this.mqtt.setWill({
  topic: "gateways/gateway-7/death",
  payload: encodeDeath({ sequence: this.sequence }),
  qos: 1,
});
```

The broker reads the will from the CONNECT packet, so the open connection
keeps the will it connected with: `setWill()` applies to the next connect or
reconnect. Call it before `start` for the first connection. `setWill(undefined)`
clears it. Once called, it wins over the atom.

## Device topics

Business code does not hold topic strings: it declares `$topic`s, and
`@alepha/mqtt/topic` carries them over MQTT. A device topic names
`MqttTopicProvider`:

```typescript check
import { AlephaTopicMqtt, MqttTopicProvider } from "@alepha/mqtt/topic";
import { z } from "alepha";
import { $subscriber, $topic } from "alepha/topic";

class DeviceStatus {
  status = $topic({
    name: "mcs/v1/{site}/{device}/status",
    provider: MqttTopicProvider,
    schema: {
      params: z.object({ site: z.text(), device: z.text() }),
      payload: z.object({ state: z.enum(["ok", "degraded", "down"]) }),
    },
    mqtt: { qos: 1, share: "mcs" },
  });

  onStatus = $subscriber({
    topic: this.status,
    handler: async ({ params, payload }) => {
      // params.site, params.device: from the topic the message arrived on.
      console.log(params.device, payload.state);
    },
  });
}
```

Register `AlephaTopicMqtt` (it brings `AlephaMqtt` and `alepha/topic`).

- **Opt in per topic.** `MqttTopicProvider` is never the app's
  `TopicProvider`: the framework's own topics (WebSocket broadcasts,
  `parameter:sync`) stay on memory or Redis, off the device broker.
- **Exact names.** The topic name is the contract with the devices, so
  nothing is added to it. The `mqttTopicOptions` atom's `prefix` (empty by
  default) is joined with `/` when an app does want one.
- **Params are `+` wildcards.** A subscriber on
  `mcs/v1/{site}/{device}/status` subscribes to `mcs/v1/+/+/status` and
  receives the params of each message's topic. `publish({ params, payload })`
  fills them in. `wait()` works on a templated name too, and its `filter`
  sees the params.
- **The wire format is the payload alone**, as UTF-8 JSON: `{"state":"ok"}`,
  which is what a device publishes. Memory and Redis wrap it in
  `{ "payload": ... }`; MQTT does not. A message that does not decode, or
  does not match the schema, is logged and dropped.
- **QoS 1 by default**, so an awaited `publish()` means the broker has the
  message. `mqtt: { qos }` changes it for both publishing and subscribing.
  `retain: true` on the `$topic` publishes retained.

### Shared groups and idempotent handlers

Without `share`, every instance of the app receives every device message,
which is right for a notification fan-out and wrong for ingestion: three
instances write each status three times. `mqtt: { share: "mcs" }` makes the
instances one group, and the broker hands each message to one of them. On
that instance, the topic's `handler` and every `$subscriber` run. `wait()`
never joins the group, so a one-shot listener does not steal a message from
the group's handlers.

QoS 1 is _at least once_: after a reconnect, a broker may deliver a message
again, shared group or not. **Handlers on device topics must be idempotent**:
key a write on the device and a sequence number or timestamp the device
sends, not on the arrival.

## Testing on the memory broker

Without `MQTT_URL`, tests run on `MemoryMqttClientProvider`: no broker, no
socket, no timing. `publish` resolves once every subscriber's callback has
run, so a spec asserts right after it.

Two containers, a device and the app under test, share a broker with
`useBroker()`, before they start:

```typescript check
import {
  AlephaMqtt,
  MemoryMqttBroker,
  MemoryMqttClientProvider,
} from "@alepha/mqtt";
import { Alepha } from "alepha";

const device = Alepha.create().with(AlephaMqtt);
const app = Alepha.create().with(AlephaMqtt);

app.inject(MemoryMqttClientProvider).useBroker(device.inject(MemoryMqttBroker));

await device.start();
await app.start();
```

`simulateDisconnect()` drops the connection as a network cut would: the
broker publishes the will, then the client reconnects and restores its
subscriptions (unless `reconnectPeriod` is `0`). `broker.retainedMessage(topic)`
reads what the broker has retained.

The memory broker keeps the semantics a real one has (wildcards, `$` topics,
retained messages, the delivered QoS, shared groups round robin, the will
read at connect), and the framework proves it: one contract suite runs on the
memory broker and on Mosquitto, with the same assertions.
