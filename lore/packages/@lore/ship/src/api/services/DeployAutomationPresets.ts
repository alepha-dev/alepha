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
 * A validated app name spans its environments. Only persisted failure events
 * contain the safe frozen fields; raw deployment errors/logs never enter it.
 */
export class DeployAutomationPresets {
  protected readonly builder = new AutomationGraphBuilder();
  protected readonly presets = $inject(AutomationPresetRegistry);
  protected readonly vocabulary = new AutomationVocabulary();
  constructor() {
    const source = this.vocabulary.find("deploy.failed")!;
    this.presets.register(
      {
        key: "deploy-failed",
        title: "Deployment failed",
        description:
          "Notify one member when a deployment of the chosen app records a failure, in any environment. Raw logs are excluded.",
        source: source.key,
        fields: source.fields,
        needs: source.needs,
        permissions: ["automation:write", "member:read", ...source.permissions],
        slots: {
          app: {
            kind: "text",
            bindable: true,
            resource: "app",
            required: true,
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
      (values, bindings) => this.failure({ ...values, ...bindings }),
    );
  }
  protected failure(values: AutomationPresetValues): AutomationGraphValue {
    return this.builder.line({
      source: "deploy.failed",
      filters: { app: String(values.app) },
      actions: [
        {
          kind: "notify",
          ...(values.recipient !== undefined && values.recipient !== ""
            ? { recipient: String(values.recipient) }
            : {}),
          channel: String(values.channel),
          category: "automations",
          title: "Deployment failed: {{app}} ({{env}})",
          text: "Deployment {{deployment_id}}\nApp: {{app}}\nEnvironment: {{env}}\nTag: {{tag}}\nDigest: {{digest}}\nReason: {{reason}}\n{{url}}",
        },
      ],
    });
  }
}
