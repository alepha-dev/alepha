import {
  currentProjectAtom,
  ProjectShellRegistry,
  hasCapability,
  ProjectSettingsCapabilitySection,
} from "@lore/core/web";
import { useInject, useStore } from "alepha/react";

import ProjectSettingsRoadmapSwitch from "./ProjectSettingsRoadmapSwitch.tsx";

/**
 * Quests > Features: how quests behave, and whether the roadmap is on.
 *
 * The master switch and the options that add a sidebar entry (board, epics,
 * releases) are in General > Capabilities since #Q2565. The board's columns,
 * the tag colours (#Q4061) and the prompts have tabs of their own.
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

      {/* The roadmap on or off (#Q4060); who may read it is its own tab,
          listed while it is on. */}
      {workEnabled && <ProjectSettingsRoadmapSwitch />}
    </div>
  );
};

export default ProjectSettingsWorkPage;
