import { AlephaError } from "alepha";

import type { AutomationDescriptor } from "./automationDescriptorSchema.ts";
import type { AutomationSlotKind } from "./automationSlotKindSchema.ts";
import type { AutomationSlot } from "./automationSlotSchema.ts";
import type { CapabilityKey } from "./capabilityKeySchema.ts";

/**
 * Browser-safe vocabulary. Resolvers and current authorization live on the server.
 */
export class AutomationVocabulary {
  public static readonly RESERVED_KEYS = [
    "__proto__",
    "prototype",
    "constructor",
  ] as const;
  /**
   * The kinds of node an automation graph holds (#Q3803): a `source` starts
   * a run, a `read` selects what a schedule reads, a `condition` sends the
   * run down its `true` or `false` port, an `action` has an effect.
   * `transform` is reserved for steps that do not exist yet (an AI
   * transform, a sandbox run): the graph schema refuses it until a node type
   * registers it, so adding one needs no new storage.
   */
  public static readonly KINDS = [
    "source",
    "read",
    "condition",
    "action",
    "transform",
  ] as const;
  public static readonly RESERVED_KINDS: readonly AutomationNodeKind[] = [
    "transform",
  ];
  /**
   * The built-in source type that runs on a UTC cron rather than an event.
   */
  public static readonly SCHEDULE = "schedule";
  /**
   * The built-in condition type: one comparison of a field, the v1 guard.
   */
  public static readonly COMPARE = "compare";
  protected readonly entries = new Map<string, AutomationDescriptor>();
  protected readonly common: Record<string, AutomationSlotKind> = {
    project: "text",
    title: "text",
    url: "text",
  };

  constructor() {
    this.event(
      "feedback.created",
      {
        feedback_id: "number",
        shortId: "number",
        reference: "text",
        description: "text",
      },
      "feedback:read",
      "plan",
      "feedback",
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
      "plan",
      "releases",
    );
    this.event(
      "epic.completed",
      { epic_id: "number", shortId: "number", quest_count: "number" },
      "epic:read",
      "plan",
      "epics",
    );
    this.event(
      "quest.completed",
      { quest_id: "number", shortId: "number" },
      "quest:read",
      "plan",
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
        "ship",
        "deploy",
        { app: { kind: "text", required: false, resource: "app" } },
      );
    }
    // Uptime (#Q3610): an incident opened after the monitor's confirmations,
    // and its recovery. A single failed probe records nothing.
    for (const key of ["monitor.down", "monitor.up"]) {
      this.event(
        key,
        {
          monitor_id: "text",
          monitor: "text",
          kind: "text",
          target: "text",
          cause: "text",
          error: "text",
          started_at: "text",
          ...(key === "monitor.up"
            ? { ended_at: "text", duration_secs: "number" }
            : {}),
        },
        "app:read",
        "ship",
        "uptime",
        { monitor: { kind: "text", required: false, resource: "monitor" } },
      );
    }
    // Hosts (#Q3627): a Cloudflare token the nightly check found invalid,
    // and a throwaway host past its TTL; a Bay host gone past its grace period,
    // and its return (#Q3733). Raised in the host's home project.
    // Safe fields only: never the credential.
    for (const key of [
      "host.credential_invalid",
      "host.expired",
      "host.offline",
      "host.online",
    ]) {
      this.event(
        key,
        { host_id: "text", host: "text", kind: "text", since: "text" },
        "host:read",
        "ship",
        undefined,
        { host: { kind: "text", required: false, resource: "host" } },
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
      needs: [{ capability: "plan" }],
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
        total_is_exact: "boolean",
        selected_count: "number",
        truncated: "boolean",
        tag: "text",
      },
      itemFields: questFields,
      slots: { tag: { kind: "text", required: true } },
      permissions: ["quest:read"],
      needs: [{ capability: "plan" }],
      operators: [],
    });
    this.register({
      key: "reports.summary",
      type: "selection",
      result: "collection",
      fields: {
        ...this.common,
        summary: "text",
        total: "number",
        total_is_exact: "boolean",
        selected_count: "number",
        truncated: "boolean",
      },
      itemFields: { key: "text", value: "text", previous: "text" },
      slots: {},
      permissions: ["stats:read"],
      needs: [],
      operators: [],
    });
    this.register({
      key: "quests.remindersDue",
      type: "selection",
      result: "rows",
      fields: {
        ...questFields,
        assignee_id: "member",
        reminder_interval: "text",
        reminder_interval_ms: "number",
        reminder_next_at: "text",
      },
      slots: {},
      permissions: ["quest:read"],
      needs: [{ capability: "plan", option: "reminder" }],
      operators: [],
    });
    this.action(
      "notify",
      {
        recipient: { kind: "member", required: false },
        audience: {
          kind: "text",
          required: false,
          bindable: false,
          values: ["projectMembersExceptPublisher"],
        },
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
      [{ capability: "remember" }],
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
      [{ capability: "plan" }],
    );
    this.action(
      "assignRelease",
      {
        quest: { kind: "number", required: true, resource: "quest" },
        release: { kind: "release", required: true },
      },
      ["quest:update", "release:read"],
      [{ capability: "plan", option: "releases" }],
    );
    this.action(
      "addTag",
      {
        quest: { kind: "number", required: true, resource: "quest" },
        tag: { kind: "text", required: true, template: true, min: 1, max: 255 },
      },
      ["quest:update"],
      [{ capability: "plan" }],
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
    capability: CapabilityKey,
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

export type AutomationNodeKind = (typeof AutomationVocabulary.KINDS)[number];
