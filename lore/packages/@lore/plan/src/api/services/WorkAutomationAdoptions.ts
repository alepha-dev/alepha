import {
  AutomationAdoptionRegistry,
  AutomationAudience,
  AutomationLegacyDispatch,
  LoreInboxNotifications,
} from "@lore/core/api";
import {
  AutomationRuleChannels,
  projects,
  automationRuleSchema,
  type AutomationRule,
} from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

/**
 * Work owns the compatibility contract. Core owns consent, authority and cutover.
 */
export class WorkAutomationAdoptions {
  protected readonly registry = $inject(AutomationAdoptionRegistry);
  protected readonly audience = $inject(AutomationAudience);
  protected readonly dispatch = $inject(AutomationLegacyDispatch);
  protected readonly inbox = $inject(LoreInboxNotifications);
  protected readonly projects = $repository(projects);
  constructor() {
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
    // Compared in the authored form: a stored rule names `channels`
    // (#Q3613), the policy's build one `channel`.
    const shape = (value: AutomationRule) =>
      JSON.stringify(
        automationRuleSchema.parse({
          ...AutomationRuleChannels.normalize(value),
          actions: AutomationRuleChannels.normalize(value).actions.map(
            (action) =>
              action.kind === "notify"
                ? { ...action, title: "", text: "" }
                : action,
          ),
        }),
      );
    return shape(rule) === shape(expected);
  }
}
