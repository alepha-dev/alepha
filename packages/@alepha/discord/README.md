# Alepha @alepha/discord

A Discord notification channel for `alepha/api/notifications`. It posts an ops
message into a Discord room through an incoming webhook, and that is all it
does.

> Hand-written rather than generated. `yarn copy` generates a README from the
> module's `@module` block for **published** packages only, and this one is
> still `private`. It becomes generated the day it is published.

## Installation

```bash
yarn add @alepha/discord
```

## Usage

```typescript
import { Alepha, z } from "alepha";
import {
  $notification,
  AlephaApiNotifications,
} from "alepha/api/notifications";
import { AlephaDiscordNotifications, discordOptions } from "@alepha/discord";

const alepha = Alepha.create()
  .with(AlephaApiNotifications)
  .with(AlephaDiscordNotifications);

alepha.set(discordOptions, {
  destinations: {
    alerts: { webhook: process.env.DISCORD_ALERTS!, default: true },
    releases: { webhook: process.env.DISCORD_RELEASES! },
  },
});

class Releases {
  readonly shipped = $notification({
    schema: z.object({ tag: z.text() }),
    discord: { to: "releases", message: (v) => `shipped ${v.tag}` },
  });

  async announce(tag: string) {
    await this.shipped.push({ variables: { tag } });
  }
}
```

There is no `contact`: this is a **sink**. It fires at a destination named in
the template rather than at a person, so it skips the suppression list, the
preference provider and the unsubscribe machinery entirely.

Importing from `@alepha/discord` is what puts the `discord` key on
`$notification`. There is no subpath export, because a type augmentation
applies only where it is in scope.

## Destinations

| field       | meaning                                                           |
| ----------- | ----------------------------------------------------------------- |
| `webhook`   | the incoming webhook url Discord issued for one channel           |
| `default`   | used by a template that names no `to`. At most one may declare it |
| `username`  | overrides the webhook's own name for messages sent here           |
| `avatarUrl` | overrides the webhook's own avatar                                |

A template picks one with `to`, which is a **literal string, never a
function**. Dynamic routing would reduce the boot check below to "the map is
not empty" and put a typo'd room back at 3am. A template that needs two rooms
declares two channel blocks.

## The webhook is a credential

It lives in the atom and nowhere else: never in template code, never in a
queued outbox row, never on a delivery receipt, never in an error message. A
receipt records `discord:releases`.

The admin preview cannot reach it either, and that is by construction rather
than by care: the channel carries the resolved webhook in its own private
rendered type, and the preview controller returns only `NotificationRendered`'s
base fields.

> One caveat that is not this package's to fix: `HttpClient` logs the request
> url at `DEBUG`. Running an app at `LOG_LEVEL=debug` therefore writes webhook
> urls into its own logs.

## Boot checks

A misconfiguration fails at boot rather than as an alert that silently never
arrives. Refused: an empty destinations map, a destination with no webhook, a
url that is not a Discord webhook, two destinations flagged `default` (the room
a template reaches would depend on key order), and a template naming a
destination nobody configured.

## Testing

The single network call is behind `DiscordTransport`. Substitute the memory
implementation through the container, never `vi.mock`:

```typescript
const alepha = Alepha.create()
  // Before the module, so it wins the optional substitution.
  .with({ provide: DiscordTransport, use: MemoryDiscordTransport })
  .with(AlephaApiNotifications)
  .with(AlephaDiscordNotifications);

const transport = alepha.inject(MemoryDiscordTransport);
expect(transport.wasPostedTo(RELEASES)).toBe(true);
expect(transport.last()?.payload.content).toBe("shipped v1.2.3");
```

`posts`, `wasPostedTo()`, `wasPostedMatching()`, `last()`, `clear()` and a
`failWith` switch that makes the next post throw.

## Retries

None here. `sendNotification` already retries three times, and a second
backoff inside the transport would multiply the first. A refused post throws,
the sender writes a `failed` receipt, and the job retries.

`Retry-After` is not honoured: `HttpClient` throws before returning a
response, so the header is out of reach without dropping to raw `fetch`.

## Not in scope

Bot tokens, the gateway, slash commands, DMs, embeds, threads, file uploads,
rate-limit queueing. This package exists to post an ops message into a room,
and to prove that a delivery channel can live outside the framework.

## Links

- [Notifications guide](https://alepha.dev/docs/guides-server-notifications)
- [alepha.dev](https://alepha.dev)
