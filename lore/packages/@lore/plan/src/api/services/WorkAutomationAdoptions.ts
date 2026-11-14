import {
  AutomationAdoptionRegistry,
  AutomationAudience,
  AutomationLegacyDispatch,
  LoreInboxNotifications,
} from "@lore/core/api";
import {
  projects,
  automationRuleSchema,
  type AutomationRule,
} from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { quests } from "../entities/quests.ts";
import { QuestNotifications } from "../notifications/QuestNotifications.ts";
import { OpenQuestScope } from "./OpenQuestScope.ts";

/**
 * Work owns the compatibility contract. Core owns consent, authority and cutover.
 */
export class WorkAutomationAdoptions {
  protected readonly registry = $inject(AutomationAdoptionRegistry);
  protected readonly audience = $inject(AutomationAudience);
  protected readonly dispatch = $inject(AutomationLegacyDispatch);
  protected readonly inbox = $inject(LoreInboxNotifications);
  protected readonly notifications = $inject(QuestNotifications);
  protected readonly projects = $repository(projects);
  protected readonly quests = $repository(quests);
  protected readonly open = $inject(OpenQuestScope);
  constructor() {
    this.registry.register("quest-reminders", {
      title: "Per-quest reminders",
      description:
        "Preserves hourly processing, each quest's interval and due state, assignee email, reminder controls and reminder_sent history.",
      permissions: ["automation:write", "quest:read", "member:read"],
      channels: ["email"],
      build: () => this.reminders(),
      matches: (rule) => this.matches(rule, this.reminders()),
      preview: (projectId) => this.reminderPreview(projectId),
    });
    this.registry.register("release-notifications", {
      title: "Release announcements",
      description:
        "Notifies the current project roster except the publisher through inbox and email, respecting releases preferences. No folio is required.",
      permissions: ["automation:write", "release:read", "member:read"],
      channels: ["inbox", "email"],
      build: () => this.releases(),
      matches: (rule) => this.matches(rule, this.releases()),
      preview: async (projectId, author) => {
        const result = await this.audience.preview(projectId, author);
        return {
          recipients: result.recipients,
          recipientsHasMore: result.hasMore,
        };
      },
    });
    this.dispatch.register(
      this.inbox.inboxReleasePublished.name,
      "release-notifications",
      async (payload) => {
        const scope = payload.variables?.scope;
        if (typeof scope !== "string" || !/^project:[1-9][0-9]*$/.test(scope))
          return undefined;
        const id = Number(scope.slice(8));
        return Number.isSafeInteger(id) && (await this.projects.findById(id))
          ? id
          : undefined;
      },
    );
    this.dispatch.register(
      this.notifications.questReminder.name,
      "quest-reminders",
      async (payload) => {
        const explicit = payload.variables?.projectId;
        if (
          typeof explicit === "number" &&
          Number.isSafeInteger(explicit) &&
          (await this.projects.findById(explicit))
        )
          return explicit;
        const url = payload.variables?.questUrl;
        if (typeof url !== "string") return undefined;
        const match = /\/([^/]+)\/quests\/[0-9]+(?:[?#].*)?$/.exec(url);
        if (!match) return undefined;
        return (
          await this.projects.findOne({
            where: { slug: decodeURIComponent(match[1]) },
          })
        )?.id;
      },
    );
  }
  protected reminders(): AutomationRule {
    return {
      version: 1,
      compatibility: "quest-reminders",
      trigger: { kind: "schedule", cron: "0 * * * *" },
      select: { kind: "rows", key: "quests.remindersDue", filters: {} },
      guard: null,
      actions: [
        {
          kind: "notify",
          recipient: "{{assignee_id}}",
          channel: "email",
          category: "reminders",
          title: "Quest reminder",
          text: "{{project}}: {{title}} (#Q{{shortId}}) is still open. Open quest: {{url}}. Change the cadence or turn reminders off in the quest Settings panel.",
        },
      ],
    };
  }
  protected releases(): AutomationRule {
    return {
      version: 1,
      compatibility: "release-notifications",
      trigger: { kind: "event", event: "release.published" },
      select: null,
      guard: null,
      actions: ["inbox", "email"].map((channel) => ({
        kind: "notify",
        audience: "projectMembersExceptPublisher",
        channel,
        category: "releases",
        title: "Release published",
        text: "{{project}}: {{title}} ({{release_tag}}) has shipped. {{url}}",
      })),
    };
  }
  protected matches(rule: AutomationRule, expected: AutomationRule): boolean {
    // Copy may be edited, while every behavior-bearing field stays compatible.
    const shape = (value: AutomationRule) =>
      JSON.stringify(
        automationRuleSchema.parse({
          ...value,
          actions: value.actions.map((action) =>
            action.kind === "notify"
              ? { ...action, title: "", text: "" }
              : action,
          ),
        }),
      );
    return shape(rule) === shape(expected);
  }
  protected async reminderPreview(projectId: number) {
    const where = await this.open.where([projectId]);
    where.acceptedAt = { isNotNull: true };
    where.acceptedBy = { isNotNull: true };
    where.reminderInterval = { isNotNull: true };
    where.reminderNextAt = { isNotNull: true };
    const rows = await this.quests.findMany({
      where,
      orderBy: "shortId",
      limit: 51,
    });
    const selected = rows.slice(0, 50);
    return {
      recipients: [...new Set(selected.map((quest) => quest.acceptedBy!))].map(
        (id) => ({ value: id, label: id }),
      ),
      recipientsHasMore: rows.length > 50,
      reminderCount: await this.quests.count(where),
      reminders: selected.map((quest) => ({
        id: quest.id,
        shortId: quest.shortId,
        assigneeId: quest.acceptedBy!,
        interval: quest.reminderInterval!,
        nextAt: quest.reminderNextAt!,
      })),
    };
  }
}
