# NotificationChannel

## Import

```typescript
import { NotificationChannel } from "alepha/api/notifications";
```

## Overview

One delivery channel, and the extension point of the whole module.

A channel is a **service**, not a primitive: it has dependencies (an http
client, an options atom, a boot-time config check) and this codebase
models transports as services. Discovery is `alepha.services()`.

⚠️ **A channel must be listed in its module's `services[]`.**
`alepha.services()` walks the registry and filters on `instanceof`, so it
sees _instantiated_ services only: a channel that is exported but never
injected is invisible, and the symptom is the boot check refusing a
template that declares your own channel.

## What a plugin has to declare

A channel is three things, not one: the class below, the option block a
template writes, and, for a sink, the fact that it is one. The last two are
declaration merges, and they belong in the package's single entry point,
because an augmentation only applies where it is in scope.

```ts
declare module "alepha/api/notifications" {
  interface NotificationChannels<V> {
    discord?: { to?: string; message: (v: V) => string | Promise<string> };
  }
  interface NotificationSinkChannels {
    discord: true;
  }
}
```

Declaring only the first compiles, and then `push()` keeps demanding a
`contact` for a message going to a chatroom.

## Two members that look optional and are not

`render()` must return a **`recipient`**. It is not decoration: the sender
writes it straight into `notification_deliveries.contact`, which is
`NOT NULL`, and it is the only reason the sender never has to ask what kind
of channel it is talking to. An addressable channel returns the contact it
was given; a sink returns `<channel>:<destination>`.

**`providerName()`** should be overridden by any channel that is an adapter
over a swappable transport, to name that transport. The default is the
channel's own class name, which is right for a channel that IS its
transport and wrong for one that wraps a provider: without the override,
every receipt records `NotificationEmailChannel` where an operator is
looking for `BrevoEmailProvider`. Nothing asserts on that field by default,
so getting it wrong degrades the audit trail silently.
