import {
  currentProjectAtom,
  ProjectShellRegistry,
  hasCapability,
  ProjectSettingsCapabilitySection,
} from "@lore/core/web";
import { useInject, useStore } from "alepha/react";

import ProjectSettingsRoadmapSection from "./ProjectSettingsRoadmapSection.tsx";

/**
 * Quests > Features: how quests behave, and who may read the roadmap.
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

      {/* Who may read `/:projectSlug/roadmap`. It draws releases and the
          epics inside them, so it moved here with them from the Releases
          page. */}
      {workEnabled && <ProjectSettingsRoadmapSection />}
    </div>
  );
};

export default ProjectSettingsWorkPage;
