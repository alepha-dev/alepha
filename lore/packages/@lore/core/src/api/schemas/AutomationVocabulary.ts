import { AlephaError } from "alepha";

import type { AutomationDescriptor } from "./automationDescriptorSchema.ts";
import type { AutomationSlotKind } from "./automationSlotKindSchema.ts";
import type { AutomationSlot } from "./automationSlotSchema.ts";

/**
 * Browser-safe vocabulary. Resolvers and current authorization live on the server.
 */
export class AutomationVocabulary {
  public static readonly RESERVED_KEYS = [
    "__proto__",
    "prototype",
    "constructor",
  ] as const;
  protected readonly entries = new Map<string, AutomationDescriptor>();
  protected readonly common: Record<string, AutomationSlotKind> = {
    project: "text",
    title: "text",
    url: "text",
  };

  constructor() {
    this.event(
      "feedback.created",
      { feedback_id: "number", shortId: "number" },
      "feedback:read",
      "support",
    );
    this.event(
      "release.published",
      {
        release_id: "release",
        release_tag: "text",
        publisher_id: "member",
        changelog: "text",
        quest_count: "number",
      },
      "release:read",
      "work",
      "releases",
    );
    this.event(
      "epic.completed",
      { epic_id: "number", shortId: "number", quest_count: "number" },
      "epic:read",
      "work",
      "epics",
    );
    this.event(
      "quest.completed",
      { quest_id: "number", shortId: "number" },
      "quest:read",
      "work",
    );
    for (const key of ["deploy.failed", "deploy.succeeded"]) {
      this.event(
        key,
        {
          deployment_id: "text",
          app: "text",
          env: "text",
          tag: "text",
          digest: "text",
          reason: "text",
        },
        "app:read",
        "apps",
        "deploy",
        { app: { kind: "text", required: false, resource: "app" } },
      );
    }
    const questFields: Record<string, AutomationSlotKind> = {
      ...this.common,
      quest_id: "number",
      shortId: "number",
      status: "text",
      area: "text",
    };
    this.register({
      key: "quests.open",
      type: "selection",
      result: "rows",
      fields: questFields,
      slots: {
        tag: { kind: "text", required: false },
        area: { kind: "text", required: false, max: 48 },
      },
      permissions: ["quest:read"],
      needs: [{ capability: "work" }],
      operators: [],
    });
    this.register({
      key: "quests.tagged",
      type: "selection",
      result: "collection",
      fields: {
        ...this.common,
        summary: "text",
        total: "number",
        truncated: "boolean",
        tag: "text",
      },
      slots: { tag: { kind: "text", required: true } },
      permissions: ["quest:read"],
      needs: [{ capability: "work" }],
      operators: [],
    });
    this.register({
      key: "quests.remindersDue",
      type: "selection",
      result: "rows",
      fields: {
        ...questFields,
        assignee_id: "member",
        reminder_interval: "number",
        reminder_next_at: "text",
      },
      slots: {},
      permissions: ["quest:read"],
      needs: [{ capability: "work", option: "reminder" }],
      operators: [],
    });
    this.action(
      "notify",
      {
        recipient: { kind: "member", required: true },
        channel: { kind: "channel", required: true },
        title: { kind: "text", required: true, template: true, max: 16_384 },
        text: { kind: "text", required: true, template: true, max: 16_384 },
        category: {
          bindable: false,
          kind: "text",
          required: true,
          values: ["automations", "releases", "reminders"],
        },
      },
      ["member:read"],
      [],
    );
    this.action(
      "appendFolio",
      {
        folio: { kind: "folio", required: true },
        text: { kind: "text", required: true, template: true, max: 16_384 },
      },
      ["folio:read", "folio:write"],
      [{ capability: "knowledge" }],
    );
    this.action(
      "createQuest",
      {
        title: { kind: "text", required: true, template: true, max: 255 },
        description: {
          kind: "text",
          required: true,
          template: true,
          max: 16_384,
        },
        area: { kind: "text", required: true, max: 48 },
      },
      ["quest:create"],
      [{ capability: "work" }],
    );
    this.action(
      "assignRelease",
      {
        quest: { kind: "number", required: true, resource: "quest" },
        release: { kind: "release", required: true },
      },
      ["quest:update", "release:read"],
      [{ capability: "work", option: "releases" }],
    );
    this.action(
      "addTag",
      {
        quest: { kind: "number", required: true, resource: "quest" },
        tag: { kind: "text", required: true, template: true, min: 1, max: 255 },
      },
      ["quest:update"],
      [{ capability: "work" }],
    );
  }

  public register(entry: AutomationDescriptor): void {
    if (this.entries.has(entry.key))
      throw new AlephaError(
        `Automation vocabulary '${entry.key}' is registered twice`,
      );
    this.entries.set(entry.key, entry);
  }
  public all(): AutomationDescriptor[] {
    return [...this.entries.values()];
  }
  public find(key: string): AutomationDescriptor | undefined {
    return this.entries.get(key);
  }
  public commonFields(): Record<string, AutomationSlotKind> {
    return { ...this.common };
  }
  public reservedNames(): Set<string> {
    return new Set([
      ...AutomationVocabulary.RESERVED_KEYS,
      ...this.all().flatMap((entry) => Object.keys(entry.fields)),
    ]);
  }

  protected event(
    key: string,
    fields: Record<string, AutomationSlotKind>,
    permission: string,
    capability: "work" | "knowledge" | "apps" | "support",
    option?: string,
    slots: Record<string, AutomationSlot> = {},
  ): void {
    this.register({
      key,
      type: "event",
      result: "event",
      fields: { ...this.common, ...fields },
      slots,
      permissions: [permission],
      needs: [{ capability, ...(option ? { option } : {}) }],
      operators: [],
    });
  }
  protected action(
    key: string,
    slots: Record<string, AutomationSlot>,
    permissions: string[],
    needs: AutomationDescriptor["needs"],
  ): void {
    this.register({
      key,
      type: "action",
      result: "effect",
      fields: {},
      slots,
      permissions,
      needs,
      operators: [],
    });
  }
}
