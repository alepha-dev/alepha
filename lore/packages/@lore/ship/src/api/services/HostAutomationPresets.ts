import {
  AutomationPresetRegistry,
  type AutomationPresetValues,
} from "@lore/core/api";
import { AutomationVocabulary, type AutomationRule } from "@lore/core/schemas";
import { $inject } from "alepha";

/**
 * Host alert presets (#Q3627): **Host token invalid** and **Host past its
 * TTL**, which replace `HostNotifications`. `host` is optional: set, one
 * host (that host's bell binds it); unset, every host of the project.
 */
export class HostAutomationPresets {
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
  }
  protected register(
    key: string,
    title: string,
    description: string,
    event: "host.credential_invalid" | "host.expired",
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
    event: "host.credential_invalid" | "host.expired",
    message: { title: string; text: string },
    values: AutomationPresetValues,
  ): AutomationRule {
    return {
      version: 1,
      trigger: {
        kind: "event",
        event,
        ...(values.host !== undefined && values.host !== ""
          ? { host: String(values.host) }
          : {}),
      },
      select: null,
      guard: null,
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
    };
  }
}
