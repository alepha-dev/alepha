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
    this.register(
      "release-to-folio",
      "Publish release notes to a folio",
      "Append the frozen published changelog to a chosen folio, then notify one member. Each publication appends once.",
      "release.published",
      (values) => this.release(values),
      undefined,
      { folio: { kind: "folio", required: true } },
      ["appendFolio", "notify"],
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
    actions: string[] = ["notify"],
  ) {
    const entry = this.vocabulary.find(source)!;
    const effects = actions.map((action) => this.vocabulary.find(action)!);
    this.presets.register(
      {
        key,
        title,
        description,
        source,
        ...(schedule ? { schedule } : {}),
        fields: entry.fields,
        needs: [
          { capability: "work", option: "automations" },
          ...entry.needs,
          ...effects.flatMap((effect) => effect.needs),
        ],
        permissions: [
          ...new Set([
            "automation:write",
            ...entry.permissions,
            ...effects.flatMap((effect) => effect.permissions),
          ]),
        ],
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
  ): Extract<AutomationRule["actions"][number], { kind: "notify" }> {
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
  protected release(values: AutomationPresetValues): AutomationRule {
    return {
      version: 1,
      trigger: { kind: "event", event: "release.published" },
      select: null,
      guard: null,
      actions: [
        {
          kind: "appendFolio",
          folio: String(values.folio),
          text: "## {{release_tag}}: {{title}}\n\n{{changelog}}\n\nQuests: {{quest_count}}.\n{{url}}",
        },
        {
          ...this.notify(
            values,
            "Release published: {{release_tag}}",
            "{{title}}\nQuests: {{quest_count}}.\n{{url}}",
          ),
          category: "releases",
        },
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
