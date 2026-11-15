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
  protected readonly sources: AutomationChannelInstanceSource[] = [];
  /**
   * Register the adapter for one channel `kind` (#Q3613): `inbox` and
   * `email` are built in; a module adds `discord`. A kind's adapter serves
   * every instance of that kind.
   */
  public register(kind: string, adapter: AutomationChannelAdapter): void {
    if (this.adapters.has(kind))
      throw new AlephaError(`Automation channel '${kind}' is registered twice`);
    this.adapters.set(kind, adapter);
  }
  /**
   * Register where a project's configured channels come from (#Q3613),
   * such as its Discord channels. Each instance is resolved to its adapter
   * by `kind`.
   */
  public registerInstances(source: AutomationChannelInstanceSource): void {
    this.sources.push(source);
  }
  /**
   * A project's channel instances: Inbox and Email (built in, their id is
   * their kind), then every channel the project configures. A rule's notify
   * names instance ids.
   */
  public async instances(
    projectId: number,
  ): Promise<AutomationChannelInstance[]> {
    const configured = (
      await Promise.all(this.sources.map((source) => source(projectId)))
    ).flat();
    return [
      { id: "inbox", kind: "inbox", name: "In-app" },
      { id: "email", kind: "email", name: "Email" },
      ...configured,
    ];
  }
  /**
   * The instance a channel id names in this project, or undefined.
   */
  public async instance(
    projectId: number,
    id: string,
  ): Promise<AutomationChannelInstance | undefined> {
    return (await this.instances(projectId)).find((entry) => entry.id === id);
  }
  public async adapter(projectId: number, id: string) {
    const instance = await this.instance(projectId, id);
    const adapter = instance ? this.adapters.get(instance.kind) : undefined;
    if (
      !instance ||
      !adapter ||
      !(await this.available(projectId, instance.kind, adapter))
    )
      throw new AlephaError("Automation channel is not configured");
    return { ...adapter, kind: instance.kind, instance };
  }
  protected async available(
    projectId: number,
    kind: string,
    adapter: AutomationChannelAdapter,
  ) {
    const channel = this.channels.find(kind);
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
        !!(template.options as unknown as Record<string, unknown>)[kind]
      );
    });
  }
  /**
   * Every channel instance of the project, as the gallery, the editor and
   * the dependency checks read them: `key` is the instance id.
   */
  public async all(projectId: number) {
    const result = await Promise.all(
      (await this.instances(projectId)).map(async (instance) => {
        const adapter = this.adapters.get(instance.kind);
        const available =
          !!adapter &&
          (await this.available(projectId, instance.kind, adapter));
        return {
          key: instance.id,
          kind: instance.kind,
          name: instance.name,
          addressable: adapter?.addressable ?? false,
          available,
          ...(!available
            ? {
                reason:
                  "Channel transport, template or destination is not configured",
              }
            : {}),
          required: adapter?.required ?? false,
        };
      }),
    );
    return result
      .filter((entry) => entry.available || entry.required)
      .map(({ required: _required, ...entry }) => entry);
  }
}

/**
 * One channel a project can notify (#Q3613): a built-in (`inbox`, `email`)
 * or one it configured, such as a Discord channel. `id` is what a rule's
 * notify names, at most 64 characters; `kind` picks the adapter.
 */
export interface AutomationChannelInstance {
  id: string;
  kind: string;
  name: string;
}

export type AutomationChannelInstanceSource = (
  projectId: number,
) => Promise<AutomationChannelInstance[]>;

export interface AutomationChannelAdapter {
  required?: boolean;
  addressable: boolean;
  configured: (projectId: number) => Promise<boolean>;
  target: "text" | "html" | "markdown" | "discord";
  templates: Record<"automations" | "releases" | "reminders", string>;
}
