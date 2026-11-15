import { Button } from "@alepha/ui";
import { SettingsRow, SettingsSection } from "@alepha/ui/settings";
import type { AutomationController } from "@lore/core/api";
import { canInProject, currentProjectAtom, type I18n } from "@lore/core/web";
import {
  useAction,
  useClient,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import type { QuestReminderRuleController } from "../../../../../api/controllers/QuestReminderRuleController.ts";

/**
 * The automation that sends quest reminders (#Q3626), beside the `reminder`
 * option that offers the control on each quest.
 *
 * Reminders are sent by that rule alone: the option shows the control, and
 * the rule delivers. Without one, this offers to create it from the Quest
 * reminders preset, enabled, to whoever may write automations. A project
 * holds at most one, so the offer is gone once it exists.
 */
const ProjectSettingsReminderRule = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const rules = useClient<QuestReminderRuleController>();
  const automations = useClient<AutomationController>();
  const queries = useQueryClient();
  // A core page, named from Plan: core's router is not in this package's
  // `Routers`.
  const router = useRouter<any>();
  const projectId = project?.id ?? 0;
  const key = ["quest-reminder-rule", projectId];
  const rule = useQuery(
    {
      key,
      enabled: !!project,
      handler: ({ signal }) =>
        rules.getQuestReminderRule(
          { params: { projectId } },
          { request: { signal } },
        ),
    },
    [projectId],
  );
  const create = useAction<[], void>(
    {
      handler: async () => {
        await automations.createAutomationFromPreset({
          params: { projectId },
          body: {
            key: "quest-reminders",
            values: { channel: "email" },
            enabled: true,
          },
        });
        queries.invalidate(key);
        queries.invalidate(["automations", projectId]);
      },
    },
    [automations, projectId, queries],
  );
  if (!project || !rule.data) return null;
  const canCreate = canInProject(project, "automation:write");
  const automationId = rule.data.automationId;

  return (
    <SettingsSection
      title={tr("project.settings.reminderRule.title")}
      description={tr("project.settings.reminderRule.description")}
    >
      <SettingsRow
        label={tr("project.settings.reminderRule.label")}
        description={
          rule.data.exists
            ? rule.data.enabled
              ? tr("project.settings.reminderRule.on")
              : tr("project.settings.reminderRule.disabled")
            : tr("project.settings.reminderRule.none")
        }
      >
        {rule.data.exists && automationId ? (
          <Button
            size="sm"
            variant="outlined"
            onClick={() =>
              router.push("projectAutomationDetail", {
                params: { projectSlug: project.slug, automationId },
              })
            }
          >
            {tr("project.settings.reminderRule.open")}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!canCreate || create.loading}
            onClick={() => void create.run()}
            data-testid="reminder-rule-create"
          >
            {tr("project.settings.reminderRule.create")}
          </Button>
        )}
      </SettingsRow>
    </SettingsSection>
  );
};

export default ProjectSettingsReminderRule;
