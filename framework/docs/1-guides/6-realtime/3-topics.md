# Topics

`$topic` is publish/subscribe: a named channel with a typed message, where
publishers do not know who is listening. `$subscriber` is a listener declared
beside it. They carry events inside a process, across instances over Redis, and
to devices over MQTT.

```typescript check
import { $subscriber, $topic } from "alepha/topic";
```

## Publishing and subscribing

A topic declares the shape of its message:

```typescript check
import { z } from "alepha";
import { $subscriber, $topic } from "alepha/topic";

class OrderEvents {
  placed = $topic({
    name: "orders.placed",
    schema: {
      payload: z.object({ orderId: z.uuid(), total: z.number() }),
    },
  });

  sendReceipt = $subscriber({
    topic: this.placed,
    handler: async ({ payload }) => {
      console.log("receipt for", payload.orderId);
    },
  });

  place(orderId: string, total: number) {
    return this.placed.publish({ orderId, total });
  }
}
```

`name` defaults to the property key. Any number of services can subscribe to one
topic, and each one receives every message.

| Way to listen          | Subscribed                        | Use it for                                                                  |
| ---------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| `$subscriber`          | when the app starts               | A listener in another service. It takes `use` middleware.                   |
| `handler` on the topic | when the app starts               | A listener that belongs to the topic itself.                                |
| `.subscribe(fn)`       | when you call it                  | A listener you add at runtime. It resolves to the function that removes it. |
| `.wait()`              | when you call it, for one message | Waiting for one event, see below.                                           |

`publish()` encodes the payload with the topic's schema, and each subscriber
decodes it with the same schema.

## What delivery guarantees

On the memory and Redis providers a topic is fan-out with no memory. Every
subscriber that is running receives each message, and one that is not running
misses it. Nothing acknowledges a message and nothing retries it.
[Retained messages](#retained-messages) are the one exception. MQTT has its own
rules: it acknowledges with QoS 1, may deliver twice, and can hand a message to one
instance of a [shared group](/docs/guides-realtime-mqtt#shared-groups-and-idempotent-handlers).

- **A handler that throws** is logged and goes no further: the publisher does not
  see it, and the other subscribers still run.
- **A message that does not decode** is logged and dropped.
- **With the memory provider**, `publish()` runs each handler before it returns,
  one after the other. With Redis, it returns once the message is sent.

For work that must happen, exactly one worker at a time, use a
[job](/docs/guides-features-background-jobs) instead.

## Params in the name

A topic name can hold params. Declare them in the schema, and `publish()` takes
them beside the payload:

```typescript check
import { z } from "alepha";
import { $subscriber, $topic } from "alepha/topic";

class DeviceEvents {
  status = $topic({
    name: "devices/{id}/status",
    schema: {
      params: z.object({ id: z.text() }),
      payload: z.object({ online: z.boolean() }),
    },
  });

  onStatus = $subscriber({
    topic: this.status,
    handler: async ({ params, payload }) => {
      console.log(params.id, payload.online);
    },
  });

  report(id: string, online: boolean) {
    return this.status.publish({ params: { id }, payload: { online } });
  }
}
```

A subscriber on a templated name listens to all of them, and receives the params
of the topic each message arrived on.

⚠️ Give a param a `/` segment of its own. The memory provider matches on `/` alone,
so a dotted name like `devices.{id}.status` is never delivered there, although it
is over Redis.

## Waiting for one message

`wait()` resolves with the next message, or with the next one a `filter` accepts:

```typescript
const message = await this.placed.wait({
  timeout: [5, "seconds"],
  filter: ({ payload }) => payload.orderId === orderId,
});
```

The timeout defaults to 10 seconds. Past it, `wait()` rejects with
`TopicTimeoutError`.

## Requests and replies

A topic whose schema declares `response` can be asked a question. `request()`
publishes the message and resolves with the reply, and what a `handler` or a
`$subscriber` returns is the reply:

```typescript check
import { z } from "alepha";
import { $topic } from "alepha/topic";

class Prices {
  quote = $topic({
    name: "prices.quote",
    schema: {
      payload: z.object({ sku: z.text() }),
      response: z.object({ price: z.number() }),
    },
    handler: async ({ payload }) => ({ price: payload.sku.length * 10 }),
  });

  ask(sku: string) {
    return this.quote.request({ sku }, { timeout: [2, "seconds"] });
  }
}
```

- The first reply settles the request, and later ones are dropped.
- Past `timeout`, 10 seconds by default, it rejects with the 503 `TimeoutError`.
  A client that disconnects aborts it.
- A handler that throws, or returns what the schema refuses, sends nothing, so
  the requester times out.

## Retained messages

`retain: true` keeps the last message of a topic and hands it to each new
subscriber as it subscribes, so a late joiner starts from the current value.

The memory, Redis and MQTT providers support it. Over Redis, a subscriber on a
templated name receives no retained message, because a pattern has no single key
to read.

## Providers

| Provider              | Selected                 | Reach                                                                                           |
| --------------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `MemoryTopicProvider` | by default               | This process.                                                                                   |
| `RedisTopicProvider`  | when `REDIS_URL` is set  | Every instance. Channels are `<app name>:topic:<name>`, so two apps sharing a Redis stay apart. |
| `MqttTopicProvider`   | per topic, by `provider` | Devices, see [MQTT](/docs/guides-realtime-mqtt#device-topics).                                  |

⚠️ **Without `REDIS_URL`, a message stays in its process.** On a second instance
a subscriber hears nothing, and nothing warns you. The same applies to Cloudflare
Workers: a Worker runs no Redis client, so topics there are memory only, per
isolate.

`provider: "memory"` on one `$topic` keeps it local whatever the app uses. A
substitution of your own for `TopicProvider` wins over both defaults.

The framework uses topics too: with Redis, [WebSocket](/docs/guides-realtime-websocket)
broadcasts and runtime parameter changes reach every instance this way.
