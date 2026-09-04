import { $hook, $inject, $store, Alepha, AlephaError } from "alepha";
import {
  $notification,
  NotificationChannel,
  type NotificationRendered,
  type NotificationRenderInput,
} from "alepha/api/notifications";

import { type DiscordDestination, discordOptions } from "../discordOptions.ts";
import { DiscordTransport } from "../transports/DiscordTransport.ts";

/**
 * The `discord` block of a `$notification`.
 *
 * ⚠️ **`to` is a literal string, never a function.** Dynamic routing would
 * reduce the boot check to "the destinations map is not empty" and put a
 * typo'd room back at 3am, which is the exact failure this package exists to
 * prevent. A template that needs two rooms declares two channel blocks.
 */
export interface DiscordChannelMessage<V> {
  /**
   * Which destination to post to, by name. Omitted means the one flagged
   * `default` in {@link discordOptions}.
   */
  to?: string;
  /**
   * The message text, built from the template's variables.
   */
  message: (variables: V) => string | Promise<string>;
}

/**
 * What the channel rendered, plus what only the channel may see.
 *
 * `webhook` is channel-private by construction: the sender writes a receipt
 * from `NotificationRendered`'s base fields and the admin preview returns
 * those same base fields, so nothing outside this class can read past
 * `recipient` / `body`.
 */
export interface DiscordRendered extends NotificationRendered {
  /**
   * The destination's name, which is also what `recipient` is built from.
   */
  destination: string;
  /**
   * ⚠️ The credential. Never logged, never stored, never returned.
   */
  webhook: string;
  username?: string;
  avatarUrl?: string;
}

/**
 * Post a notification into a Discord channel through an incoming webhook.
 *
 * A **sink**: it fires at a destination named in the template rather than at
 * a person, so it skips the suppression gate, the preference provider and
 * the unsubscribe machinery. There is nobody to suppress, and a suppression
 * row spelled `discord:alerts` would be indelible.
 *
 * ⚠️ **This class must stay in `AlephaDiscordNotifications`' `services[]`.**
 * `alepha.services()` filters instantiated services, so a channel that is
 * exported but never injected is invisible to the registry, and the symptom
 * is the framework's own boot check refusing a template that declares
 * `discord`.
 *
 * @example
 * ```ts
 * readonly shipped = $notification({
 *   schema: z.object({ tag: z.text() }),
 *   discord: { to: "releases", message: (v) => `shipped ${v.tag}` },
 * });
 *
 * await this.shipped.push({ variables: { tag: "v1.2.3" } });
 * ```
 */
export class DiscordNotificationChannel extends NotificationChannel<
  DiscordChannelMessage<Record<string, unknown>>,
  DiscordRendered
> {
  protected readonly alepha = $inject(Alepha);
  protected readonly options = $store(discordOptions);
  protected readonly transport = $inject(DiscordTransport);

  public readonly channel = "discord";
  public readonly addressable = false;

  public async render(
    input: NotificationRenderInput<
      DiscordChannelMessage<Record<string, unknown>>
    >,
  ): Promise<DiscordRendered> {
    const name = input.message.to ?? this.defaultDestinationName();
    const destination = this.destination(name);

    return {
      // `discord:<name>`, never the webhook. This is what lands in the
      // receipt's `contact` column and on the admin list.
      recipient: `${this.channel}:${name}`,
      body: await input.message.message(input.variables),
      destination: name,
      webhook: destination.webhook,
      username: destination.username,
      avatarUrl: destination.avatarUrl,
    };
  }

  public async send(rendered: DiscordRendered) {
    await this.transport.post(rendered.webhook, {
      content: rendered.body ?? "",
      username: rendered.username,
      avatar_url: rendered.avatarUrl,
    });
    // A plain webhook POST answers 204 with no body, so there is no id for
    // the receipt to carry and nothing later can report on this message.
    return {};
  }

  /**
   * Refuse to boot on a configuration that would only fail at 3am.
   *
   * Every one of these is a mistake whose natural symptom is an alert that
   * silently never arrives: an empty map, a url that is not a Discord
   * webhook, two defaults (so which room gets the message depends on object
   * key order), or a template naming a destination nobody configured.
   */
  protected readonly checkConfiguration = $hook({
    on: "start",
    handler: async () => {
      const destinations = this.options.destinations ?? {};
      const names = Object.keys(destinations);

      if (names.length === 0) {
        throw new AlephaError(
          "AlephaDiscordNotifications is registered but no destination is configured. " +
            'Set one with alepha.set(discordOptions, { destinations: { alerts: { webhook: "..." } } }).',
        );
      }

      for (const name of names) {
        const webhook = destinations[name]?.webhook;
        if (!webhook) {
          throw new AlephaError(
            `Discord destination "${name}" has no webhook url.`,
          );
        }
        if (!DiscordNotificationChannel.WEBHOOK_URL.test(webhook)) {
          // The url is NOT quoted back. A malformed one is usually a real
          // credential with a typo, and an error message travels further
          // than the config file it came from.
          throw new AlephaError(
            `Discord destination "${name}" does not look like a Discord webhook url. ` +
              "Expected https://discord.com/api/webhooks/<id>/<token>.",
          );
        }
      }

      const defaults = names.filter((name) => destinations[name]?.default);
      if (defaults.length > 1) {
        throw new AlephaError(
          `Discord destinations ${defaults.map((n) => `"${n}"`).join(", ")} all declare \`default\`. ` +
            "At most one may, or which room a template with no `to` reaches depends on key order.",
        );
      }

      // Every `to` a template names has to exist. This is the half the
      // framework's own boot check cannot do: it verifies that SOMETHING
      // provides `discord`, not that the room exists.
      for (const template of this.alepha.primitives($notification)) {
        const message = (template.options as Record<string, any>)[this.channel];
        if (!message) continue;

        const name = message.to;
        if (name == null) {
          if (defaults.length === 0) {
            throw new AlephaError(
              `Notification template "${template.name}" names no discord destination and none is flagged \`default\`.`,
            );
          }
          continue;
        }

        if (!destinations[name]) {
          throw new AlephaError(
            `Notification template "${template.name}" posts to discord destination "${name}", ` +
              `which is not configured. Known destinations: ${names.join(", ")}.`,
          );
        }
      }
    },
  });

  /**
   * A Discord incoming webhook url, with the api-version segment Discord
   * itself sometimes hands out and the legacy `discordapp.com` host.
   */
  protected static readonly WEBHOOK_URL =
    /^https:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/;

  protected destination(name: string): DiscordDestination {
    const destination = this.options.destinations?.[name];
    if (!destination) {
      throw new AlephaError(`Discord destination "${name}" is not configured.`);
    }
    return destination;
  }

  protected defaultDestinationName(): string {
    const destinations = this.options.destinations ?? {};
    const name = Object.keys(destinations).find(
      (key) => destinations[key]?.default,
    );
    if (!name) {
      throw new AlephaError(
        "No discord destination is flagged `default`, and this template names none.",
      );
    }
    return name;
  }
}
