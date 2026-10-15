import {
  AutomationPresetRegistry,
  type AutomationPresetValues,
} from "@lore/core/api";
import {
  AutomationVocabulary,
  type AutomationPresetDescriptor,
  type AutomationRule,
} from "@lore/core/schemas";
import { $inject } from "alepha";

/**
 * Stock Work programs retain the ordinary event/selector/notification paths.
 * Recipients are individual setup literals, never project-wide shared values.
 */
export class WorkAutomationPresets {
  protected readonly presets = $inject(AutomationPresetRegistry);
  protected readonly vocabulary = new AutomationVocabulary();
  constructor() {
    this.register(
      "feedback-created",
      "New feedback",
      "Notify one member when feedback is created. Reporter contact details are excluded.",
      "feedback.created",
      (values) => this.feedback(values),
    );
    this.register(
      "tagged-quest-digest",
      "Nightly tagged quests",
      "Send one digest of open quests with a chosen tag at 00:00 UTC. Empty digests are skipped.",
      "quests.tagged",
      (values) => this.tagged(values),
      "0 0 * * *",
      { tag: { kind: "text", required: true, min: 1, max: 128 } },
    );
    this.register(
      "epic-completed",
      "Epic completed",
      "Notify one member when an in-progress epic automatically completes.",
      "epic.completed",
      (values) => this.epic(values),
    );
  }
  protected register(
    key: string,
    title: string,
    description: string,
    source: string,
    build: (values: AutomationPresetValues) => AutomationRule,
    schedule?: string,
    extra: AutomationPresetDescriptor["slots"] = {},
  ) {
    const entry = this.vocabulary.find(source)!;
    this.presets.register(
      {
        key,
        title,
        description,
        source,
        ...(schedule ? { schedule } : {}),
        fields: entry.fields,
        needs: [{ capability: "work", option: "automations" }, ...entry.needs],
        permissions: ["automation:write", "member:read", ...entry.permissions],
        slots: {
          recipient: { kind: "member", required: true },
          channel: {
            kind: "channel",
            required: true,
            default: "inbox",
            values: ["inbox", "email"],
          },
          ...extra,
        },
      },
      build,
    );
  }
  protected notify(
    values: AutomationPresetValues,
    title: string,
    text: string,
  ): AutomationRule["actions"][number] {
    return {
      kind: "notify",
      recipient: String(values.recipient),
      channel: String(values.channel),
      title,
      text,
      category: "automations",
    };
  }
  protected feedback(values: AutomationPresetValues): AutomationRule {
    return {
      version: 1,
      trigger: { kind: "event", event: "feedback.created" },
      select: null,
      guard: null,
      actions: [
        this.notify(
          values,
          "New feedback: {{title}}",
          "Feedback {{shortId}}: {{title}}\n{{url}}\n{{project}}",
        ),
      ],
    };
  }
  protected tagged(values: AutomationPresetValues): AutomationRule {
    return {
      version: 1,
      trigger: { kind: "schedule", cron: "0 0 * * *" },
      select: {
        kind: "collection",
        key: "quests.tagged",
        filters: { tag: String(values.tag) },
      },
      guard: null,
      actions: [
        this.notify(values, "Tagged quest digest: {{tag}}", "{{summary}}"),
      ],
    };
  }
  protected epic(values: AutomationPresetValues): AutomationRule {
    return {
      version: 1,
      trigger: { kind: "event", event: "epic.completed" },
      select: null,
      guard: null,
      actions: [
        this.notify(
          values,
          "Epic completed: {{title}}",
          "Epic {{shortId}} completed. Quests: {{quest_count}}.\n{{url}}\n{{project}}",
        ),
      ],
    };
  }
}
