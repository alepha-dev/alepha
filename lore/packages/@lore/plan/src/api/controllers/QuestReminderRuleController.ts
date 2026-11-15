import { $ownsProject, AutomationPersistence } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { questReminderRuleSchema } from "../schemas/questReminderRuleSchema.ts";

/**
 * Whether the project has its quest reminder automation (#Q3626). Reminders
 * are sent only by that rule, so the quest's reminder control and the
 * `reminder` option read this to say when none exists. Readable with
 * `quest:read`: whoever sets a reminder must learn it will not be sent,
 * without needing to read automations.
 */
export class QuestReminderRuleController {
  protected readonly persistence = $inject(AutomationPersistence);

  getQuestReminderRule = $action({
    use: [
      $ownsProject({
        param: "projectId",
        requires: "quest:read",
        capability: { key: "plan" },
      }),
    ],
    method: "GET",
    path: "/projects/:projectId/quest-reminder-rule",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: questReminderRuleSchema,
    },
    handler: async ({ params }) => {
      const rules = await this.persistence.rules.findMany({
        where: { projectId: params.projectId },
        columns: ["id", "enabled", "rule"],
        limit: 500,
      });
      const rule = rules.find(
        (row) => row.rule.select?.key === "quests.remindersDue",
      );
      return rule
        ? { exists: true, enabled: rule.enabled, automationId: rule.id }
        : { exists: false, enabled: false };
    },
  });
}
