import { $inject, Alepha, AlephaError } from "alepha";
import {
  NotificationChannelService,
  $notification,
} from "alepha/api/notifications";

/**
 * Only registered transports with an automation adapter are offered. Optional
 * sink destination setup is deferred; a channel name alone installs nothing.
 */
export class AutomationChannels {
  protected readonly alepha = $inject(Alepha);
  protected readonly channels = $inject(NotificationChannelService);
  protected readonly adapters = new Map<string, AutomationChannelAdapter>([
    [
      "inbox",
      {
        required: true,
        addressable: true,
        target: "text",
        configured: async () => true,
        templates: {
          automations: "lore:automation:inbox",
          releases: "lore:automation:release-inbox",
          reminders: "lore:automation:reminder-inbox",
        },
      },
    ],
    [
      "email",
      {
        required: true,
        addressable: true,
        target: "html",
        configured: async () => true,
        templates: {
          automations: "lore:automation:email",
          releases: "lore:automation:release-email",
          reminders: "lore:automation:reminder-email",
        },
      },
    ],
  ]);
  public register(name: string, adapter: AutomationChannelAdapter): void {
    if (this.adapters.has(name))
      throw new AlephaError(`Automation channel '${name}' is registered twice`);
    this.adapters.set(name, adapter);
  }
  public async adapter(projectId: number, name: string) {
    const adapter = this.adapters.get(name);
    if (!adapter || !(await this.available(projectId, name, adapter)))
      throw new AlephaError("Automation channel is not configured");
    return adapter;
  }
  protected async available(
    projectId: number,
    key: string,
    adapter: AutomationChannelAdapter,
  ) {
    const channel = this.channels.find(key);
    if (
      !channel ||
      channel.addressable !== adapter.addressable ||
      !(await adapter.configured(projectId))
    )
      return false;
    return Object.entries(adapter.templates).every(([category, name]) => {
      const template = this.alepha
        .primitives($notification)
        .find((entry) => entry.name === name);
      return (
        template?.options.category ===
          (category === "reminders" ? "tasks" : category) &&
        !!(template.options as unknown as Record<string, unknown>)[key]
      );
    });
  }
  public async all(projectId: number) {
    const result = await Promise.all(
      [...this.adapters].map(async ([key, adapter]) => {
        const available = await this.available(projectId, key, adapter);
        return {
          key,
          addressable: adapter.addressable,
          available,
          ...(!available
            ? {
                reason:
                  "Channel transport, template or destination is not configured",
              }
            : {}),
          required: adapter.required,
        };
      }),
    );
    return result
      .filter((entry) => entry.available || entry.required)
      .map(({ required: _required, ...entry }) => entry);
  }
}

export interface AutomationChannelAdapter {
  required?: boolean;
  addressable: boolean;
  configured: (projectId: number) => Promise<boolean>;
  target: "text" | "html" | "markdown" | "discord";
  templates: Record<"automations" | "releases" | "reminders", string>;
}
