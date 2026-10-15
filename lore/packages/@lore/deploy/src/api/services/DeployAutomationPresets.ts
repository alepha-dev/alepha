import {
  AutomationPresetRegistry,
  type AutomationPresetValues,
} from "@lore/core/api";
import { AutomationVocabulary, type AutomationRule } from "@lore/core/schemas";
import { $inject } from "alepha";

/**
 * A validated app name spans its environments. Only persisted failure events
 * contain the safe frozen fields; raw deployment errors/logs never enter it.
 */
export class DeployAutomationPresets {
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
        needs: [{ capability: "work", option: "automations" }, ...source.needs],
        permissions: ["automation:write", "member:read", ...source.permissions],
        slots: {
          app: {
            kind: "text",
            resource: "app",
            required: true,
            min: 1,
            max: 255,
          },
          recipient: { kind: "member", required: true },
          channel: {
            kind: "channel",
            required: true,
            default: "inbox",
            values: ["inbox", "email"],
          },
        },
      },
      (values) => this.failure(values),
    );
  }
  protected failure(values: AutomationPresetValues): AutomationRule {
    return {
      version: 1,
      trigger: {
        kind: "event",
        event: "deploy.failed",
        app: String(values.app),
      },
      select: null,
      guard: null,
      actions: [
        {
          kind: "notify",
          recipient: String(values.recipient),
          channel: String(values.channel),
          category: "automations",
          title: "Deployment failed: {{app}} ({{env}})",
          text: "Deployment {{deployment_id}}\nApp: {{app}}\nEnvironment: {{env}}\nTag: {{tag}}\nDigest: {{digest}}\nReason: {{reason}}\n{{url}}",
        },
      ],
    };
  }
}
