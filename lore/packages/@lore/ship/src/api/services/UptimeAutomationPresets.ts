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
 * Uptime's stock presets (#Q3611): **Monitor down** on `monitor.down` and
 * **Monitor recovered** on `monitor.up`. Their texts carry the facts the
 * outage and recovery emails carried: the monitor, its address, the cause,
 * the error, when it started and, on recovery, how long it lasted.
 *
 * `monitor` is optional: unset, the rule watches every monitor of the
 * project (the `/apps` bell); set, one monitor (that monitor's bell, whose
 * subscription scope binds it).
 */
export class UptimeAutomationPresets {
  protected readonly builder = new AutomationGraphBuilder();
  protected readonly presets = $inject(AutomationPresetRegistry);
  protected readonly vocabulary = new AutomationVocabulary();
  constructor() {
    this.register(
      "monitor-down",
      "Monitor down",
      "Notify one member when a monitor's outage is confirmed, with its address, the cause and the error.",
      "monitor.down",
      {
        title: "{{monitor}} is down",
        text: "{{project}}: {{monitor}} is down since {{started_at}}.\nTarget: {{target}}\nCause: {{cause}}\nError: {{error}}\n{{url}}",
      },
    );
    this.register(
      "monitor-up",
      "Monitor recovered",
      "Notify one member when a monitor recovers from an outage, with how long it lasted.",
      "monitor.up",
      {
        title: "{{monitor}} recovered",
        text: "{{project}}: {{monitor}} is back up since {{ended_at}}, after {{duration_secs}} seconds down.\nTarget: {{target}}\nCause: {{cause}}\n{{url}}",
      },
    );
  }
  protected register(
    key: string,
    title: string,
    description: string,
    event: "monitor.down" | "monitor.up",
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
          monitor: {
            kind: "text",
            bindable: true,
            resource: "monitor",
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
    event: "monitor.down" | "monitor.up",
    message: { title: string; text: string },
    values: AutomationPresetValues,
  ): AutomationGraphValue {
    return this.builder.line({
      source: event,
      filters:
        values.monitor !== undefined && values.monitor !== ""
          ? { monitor: String(values.monitor) }
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
