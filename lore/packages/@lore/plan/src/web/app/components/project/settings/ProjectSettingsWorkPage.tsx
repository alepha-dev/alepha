import { Card, CardContent, cn } from "@alepha/ui";
import { settingsCardEdge } from "@alepha/ui/settings";
import {
  capabilityOption,
  currentProjectAtom,
  ProjectShellRegistry,
  hasCapability,
  ProjectSettingsCapabilitySection,
} from "@lore/core/web";
import { useInject, useStore } from "alepha/react";

import ProjectSettingsReminderRule from "./ProjectSettingsReminderRule.tsx";
import ProjectSettingsRoadmapSection from "./ProjectSettingsRoadmapSection.tsx";
import ProjectSettingsTagColors from "./ProjectSettingsTagColors.tsx";

/**
 * Quests > Features: how quests behave, their tag colours, and who may read
 * the roadmap.
 *
 * The master switch and the options that add a sidebar entry (board, epics,
 * releases) are in General > Capabilities since #Q2565. The board's columns
 * and the agent prompts have tabs of their own.
 */
const ProjectSettingsWorkPage = () => {
  const [project] = useStore(currentProjectAtom);
  const workEnabled = hasCapability(project, "plan");
  const shell = useInject(ProjectShellRegistry);

  return (
    <div className="flex flex-col gap-4">
      <ProjectSettingsCapabilitySection
        capability="plan"
        master={false}
        options={shell.settingsOptions("plan")}
      />

      {/* Reminders are sent by an automation (#Q3626): the option shows the
          control on each quest, and this offers the rule that delivers. */}
      {capabilityOption(project, "plan", "reminder") && (
        <ProjectSettingsReminderRule />
      )}

      {/* Tag colours belong to quests, not to the board: they render on the
          list too. Gated on the capability, not on `board`. */}
      {workEnabled && (
        <Card className={cn(settingsCardEdge, "py-4")}>
          <CardContent className="px-4">
            <ProjectSettingsTagColors />
          </CardContent>
        </Card>
      )}

      {/* Who may read `/:projectSlug/roadmap`. It draws releases and the
          epics inside them, so it moved here with them from the Releases
          page. */}
      {workEnabled && <ProjectSettingsRoadmapSection />}
    </div>
  );
};

export default ProjectSettingsWorkPage;
