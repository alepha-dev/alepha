import { $inject, AlephaError } from "alepha";
import { NotificationChannelService } from "alepha/api/notifications";

/**
 * Only registered transports with an automation adapter are offered. Optional
 * sink destination setup is deferred; a channel name alone installs nothing.
 */
export class AutomationChannels {
  protected readonly channels = $inject(NotificationChannelService);
  protected readonly adapters = new Map<
    string,
    {
      addressable: boolean;
      configured: (projectId: number) => Promise<boolean>;
    }
  >([
    [
      "inbox",
      {
        addressable: true,
        configured: async () => !!this.channels.find("inbox"),
      },
    ],
    [
      "email",
      {
        addressable: true,
        configured: async () => !!this.channels.find("email"),
      },
    ],
  ]);
  public register(
    name: string,
    adapter: {
      addressable: boolean;
      configured: (projectId: number) => Promise<boolean>;
    },
  ): void {
    if (this.adapters.has(name))
      throw new AlephaError(`Automation channel '${name}' is registered twice`);
    this.adapters.set(name, adapter);
  }
  public async all(projectId: number) {
    return Promise.all(
      [...this.adapters].map(async ([key, adapter]) => {
        const available =
          !!this.channels.find(key) && (await adapter.configured(projectId));
        return {
          key,
          addressable: adapter.addressable,
          available,
          ...(!available
            ? { reason: "Channel transport or destination is not configured" }
            : {}),
        };
      }),
    );
  }
}
