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
