import { $module } from "alepha";
import { AlephaApiNotifications } from "alepha/api/notifications";
import { AlephaHttpClient } from "alepha/server";

import {
  type DiscordChannelMessage,
  DiscordNotificationChannel,
} from "./channels/DiscordNotificationChannel.ts";
import { DiscordTransport } from "./transports/DiscordTransport.ts";
import { HttpDiscordTransport } from "./transports/HttpDiscordTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./channels/DiscordNotificationChannel.ts";
export * from "./discordOptions.ts";
export * from "./transports/DiscordTransport.ts";
export * from "./transports/HttpDiscordTransport.ts";
export * from "./transports/MemoryDiscordTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * ⚠️ **BOTH augmentations, and both from this one entry point.**
 *
 * `NotificationChannels` is what makes `$notification({ discord })`
 * typecheck; `NotificationSinkChannels` is what makes `push()` stop
 * demanding a `contact` for a message going to a room. Declaring only the
 * first compiles and then asks every caller for an address that does not
 * exist.
 *
 * There is no subpath export on this package for the same reason: an
 * augmentation only applies where it is in scope, and a subpath would make
 * "import the module, get the types" quietly untrue.
 */
declare module "alepha/api/notifications" {
  interface NotificationChannels<V> {
    discord?: DiscordChannelMessage<V>;
  }

  interface NotificationSinkChannels {
    discord: true;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Post notifications into Discord, through an incoming webhook.
 *
 * A `$notification` gains a `discord` block beside its `email` and `sms`
 * ones, and posts at a **named destination** rather than at a person: this
 * is a sink, so it skips suppression, preferences and unsubscribe entirely.
 *
 * **Scope.** Incoming webhooks and nothing else. No bot token, no gateway,
 * no slash commands, no DMs, no embeds, no threads, no file uploads. It
 * exists to post an ops message into a room, and to prove that a delivery
 * channel can live outside the framework.
 *
 * ```ts
 * import { AlephaDiscordNotifications, discordOptions } from "@alepha/discord";
 *
 * alepha.with(AlephaDiscordNotifications);
 * alepha.set(discordOptions, {
 *   destinations: {
 *     alerts: { webhook: process.env.DISCORD_ALERTS!, default: true },
 *     releases: { webhook: process.env.DISCORD_RELEASES! },
 *   },
 * });
 *
 * class Releases {
 *   readonly shipped = $notification({
 *     schema: z.object({ tag: z.text() }),
 *     discord: { to: "releases", message: (v) => `shipped ${v.tag}` },
 *   });
 * }
 * ```
 *
 * The webhook url stays in the atom: never in template code, never in a
 * queued outbox row, never on a delivery receipt. A receipt records
 * `discord:releases`.
 *
 * A misconfiguration is a boot failure rather than a message that silently
 * never arrives: an empty destinations map, a url that is not a Discord
 * webhook, two destinations flagged `default`, or a template naming a room
 * nobody configured.
 *
 * @module alepha.notifications.discord
 */
export const AlephaDiscordNotifications = $module({
  name: "alepha.notifications.discord",
  imports: [AlephaApiNotifications, AlephaHttpClient],
  // ⚠️ Listed, not merely exported. `alepha.services()` filters instantiated
  // services, so a channel nobody injects is invisible to the registry and
  // the framework's boot check fires against this very plugin.
  services: [DiscordNotificationChannel],
  register: (alepha) =>
    // `optional` so a spec can substitute `MemoryDiscordTransport` before
    // this module is registered, the same way `AlephaEmail` lets a memory
    // provider win.
    alepha.with({
      optional: true,
      provide: DiscordTransport,
      use: HttpDiscordTransport,
    }),
});
