# MqttClientProvider

## Import

```typescript
import { MqttClientProvider } from "@alepha/mqtt";
```

## Overview

MQTT 5 client provider.

Low-level MQTT client for publish/subscribe messaging, analogous to
`RedisProvider`: the transport that `@alepha/mqtt/topic` builds on.
Payloads are bytes (`string | Uint8Array` out, `Uint8Array` in), so JSON,
protobuf and Sparkplug all ride on it.

**Dispatch by Subscription Identifier.** Every broker subscription carries
its own MQTT 5 Subscription Identifier, and a received message reaches only
the subscriptions whose identifiers it carries. Matching by filter instead
would hand a message received for `$share/g/a/+` to a plain `a/+` held by
the same client too, and the copy received for `a/+` to the group's
callbacks, so a group handler would run twice, and run on an instance the
broker did not pick. Under MQTT 3.1.1 (`protocolVersion: 4`) there are no
identifiers: the client falls back to filter matching and refuses
`$share/`.

Subclasses own the wire (`sendPublish`, `sendSubscribe`, `sendUnsubscribe`,
the connection); this class owns the subscription registry, so the memory
client and mqtt.js cannot disagree about it.
