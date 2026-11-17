import {
  AutomationPresetRegistry,
  type AutomationPresetValues,
} from "@lore/core/api";
import {
  AutomationVocabulary,
  AutomationGraphBuilder,
  type AutomationGraphValue,
} from "@lore/core/schemas";
import { $inject } from "alepha";

/**
 * The `host.*` events a preset listens to.
 */
type HostAlertEvent =
  | "host.credential_invalid"
  | "host.expired"
  | "host.offline"
  | "host.online";

/**
 * Host alert presets (#Q3627): **Host token invalid** and **Host past its
 * TTL**, which replace `HostNotifications`, and **Host offline** with its
 * **Host back online** (#Q3733). `host` is optional: set, one
 * host (that host's bell binds it); unset, every host of the project.
 */
export class HostAutomationPresets {
  protected readonly builder = new AutomationGraphBuilder();
  protected readonly presets = $inject(AutomationPresetRegistry);
  protected readonly vocabulary = new AutomationVocabulary();
  constructor() {
    this.register(
      "host-credential-invalid",
      "Host token invalid",
      "Notify one member when the nightly check finds a Cloudflare host's token no longer works. Deploys through it are refused until it is replaced.",
      "host.credential_invalid",
      {
        title: "{{host}}: its Cloudflare token stopped working",
        text: "{{project}}: the token of host {{host}} failed its check ({{since}}). Deploys through it are refused until you replace it: mint a new one at Cloudflare with the same permissions, then use Replace token.\n{{url}}",
      },
    );
    this.register(
      "host-expired",
      "Host past its TTL",
      "Notify one member when a throwaway host passes its time to live. Lore stops and deletes nothing.",
      "host.expired",
      {
        title: "{{host}} is past its TTL",
        text: "{{project}}: host {{host}} passed its TTL ({{since}}). Delete it, then delete the server with its provider, or extend it.\n{{url}}",
      },
    );
    this.register(
      "host-offline",
      "Host offline",
      "Notify one member when a Bay host has stopped reporting for five minutes. A restart that reconnects sooner raises nothing.",
      "host.offline",
      {
        title: "{{host}} is offline",
        text: "{{project}}: host {{host}} stopped reporting ({{since}}). Its apps may be down, and deploys to it wait until it reconnects.\n{{url}}",
      },
    );
    this.register(
      "host-online",
      "Host back online",
      "Notify one member when a Bay host reported offline reconnects.",
      "host.online",
      {
        title: "{{host}} is back online",
        text: "{{project}}: host {{host}}, offline since {{since}}, has reconnected.\n{{url}}",
      },
    );
  }
  protected register(
    key: string,
    title: string,
    description: string,
    event: HostAlertEvent,
    message: { title: string; text: string },
  ) {
    const source = this.vocabulary.find(event)!;
    this.presets.register(
      {
        key,
        title,
        description,
        source: source.key,
        fields: source.fields,
        needs: source.needs,
        permissions: ["automation:write", "member:read", ...source.permissions],
        slots: {
          host: {
            kind: "text",
            bindable: true,
            resource: "host",
            required: false,
            min: 1,
            max: 255,
          },
          // Required only for an addressable channel (#Q3615): a Discord
          // channel is nobody's.
          recipient: { kind: "member", required: false, bindable: true },
          channel: {
            kind: "channel",
            bindable: true,
            required: true,
            default: "inbox",
          },
        },
      },
      (values, bindings) =>
        this.build(event, message, { ...values, ...bindings }),
    );
  }
  protected build(
    event: HostAlertEvent,
    message: { title: string; text: string },
    values: AutomationPresetValues,
  ): AutomationGraphValue {
    return this.builder.line({
      source: event,
      filters:
        values.host !== undefined && values.host !== ""
          ? { host: String(values.host) }
          : {},
      actions: [
        {
          kind: "notify",
          ...(values.recipient !== undefined && values.recipient !== ""
            ? { recipient: String(values.recipient) }
            : {}),
          channel: String(values.channel),
          category: "automations",
          title: message.title,
          text: message.text,
        },
      ],
    });
  }
}
