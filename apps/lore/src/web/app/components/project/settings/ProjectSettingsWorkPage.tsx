import { Card, CardContent, cn } from "@alepha/ui";
import { settingsCardEdge } from "@alepha/ui/settings";
import { useStore } from "alepha/react";

import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { hasCapability } from "@/web/app/services/projectCapabilities.ts";

import ProjectSettingsCapabilitySection from "./ProjectSettingsCapabilitySection.tsx";
import ProjectSettingsRoadmapSection from "./ProjectSettingsRoadmapSection.tsx";
import { CAPABILITY_SETTINGS_OPTIONS } from "./projectSettingsSections.ts";
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
  const workEnabled = hasCapability(project, "work");

  return (
    <div className="flex flex-col gap-4">
      <ProjectSettingsCapabilitySection
        capability="work"
        master={false}
        options={CAPABILITY_SETTINGS_OPTIONS.work}
      />

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
