import { $hook, $inject, Alepha, AlephaError } from "alepha";

import { NotificationChannel } from "../channels/NotificationChannel.ts";
import {
  $notification,
  NOTIFICATION_RESERVED_KEYS,
} from "../primitives/$notification.ts";

/**
 * The channel registry, and the boot check that keeps it honest.
 *
 * Discovery is `alepha.services(NotificationChannel)` and nothing more: a
 * channel is a service, so registering one is `alepha.with(YourModule)` and
 * there is no second registry to keep in sync.
 *
 * ⚠️ `alepha.services()` sees **instantiated** services only. A channel that
 * is exported but never listed in its module's `services[]` is invisible
 * here, and the symptom is {@link refuseUnservedChannels} refusing a
 * template that declares the plugin's own channel.
 */
export class NotificationChannelService {
  protected readonly alepha = $inject(Alepha);

  /**
   * Every channel this container can serve.
   */
  public all(): Array<NotificationChannel<any, any>> {
    return this.alepha.services(NotificationChannel);
  }

  public find(name: string): NotificationChannel<any, any> | undefined {
    return this.all().find((channel) => channel.channel === name);
  }

  /**
   * The channel by name, or a refusal naming it.
   *
   * Reachable at send time only when a channel was registered at push time
   * and gone by the time the job ran, which is a misconfiguration rather
   * than a state to render: the boot check covers everything else.
   */
  public require(name: string): NotificationChannel<any, any> {
    const channel = this.find(name);
    if (!channel) {
      throw new AlephaError(
        `No NotificationChannel provides "${name}". ${this.registeredSuffix()}`,
      );
    }
    return channel;
  }

  /**
   * Refuse to boot when a template declares a channel nothing provides.
   *
   * `NotificationPrimitive.channels()` is the intersection of what a
   * template declares with what the container registers, so a missing plugin
   * does not fail: it silently sends nothing. This turns that into a boot
   * failure, which is the difference between noticing at deploy and noticing
   * when the alert did not arrive.
   *
   * By `start()` every `$notification` has been built, which is what makes
   * the check possible here rather than at send time. A module cannot do it
   * itself: `createPrimitive` registers the module and *then* builds the
   * primitive, so a module structurally predates its own templates.
   */
  protected readonly refuseUnservedChannels = $hook({
    on: "start",
    handler: async () => {
      const provided = new Set(this.all().map((channel) => channel.channel));

      for (const template of this.alepha.primitives($notification)) {
        for (const [key, value] of Object.entries(template.options)) {
          if (key in NOTIFICATION_RESERVED_KEYS) continue;
          if (value == null) continue;
          if (provided.has(key)) continue;

          throw new AlephaError(
            `Notification template "${template.name}" declares channel "${key}", ` +
              `but no NotificationChannel provides it. Did you forget ` +
              `alepha.with(${this.moduleGuess(key)})? ${this.registeredSuffix()}`,
          );
        }
      }
    },
  });

  /**
   * The module a missing channel most likely lives in.
   *
   * A guess, and said as one: the plugin convention is
   * `AlephaDiscordNotifications` for a `discord` channel, and naming the
   * thing to import is what turns a refusal into a fix.
   */
  protected moduleGuess(channel: string): string {
    const name = channel.charAt(0).toUpperCase() + channel.slice(1);
    return `Alepha${name}Notifications`;
  }

  protected registeredSuffix(): string {
    const registered = this.all().map((channel) => channel.channel);
    return registered.length
      ? `Registered channels: ${registered.join(", ")}.`
      : "No channel is registered at all.";
  }
}
