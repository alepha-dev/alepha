import {
  ProjectShellRegistry,
  ProjectSettingsCapabilitySection,
} from "@lore/core/web";
import { useInject } from "alepha/react";

/**
 * Quests > Features: how quests behave. Whether the roadmap is on is a
 * switch on General > Capabilities, under Plan (#Q4184).
 *
 * The master switch and the options that add a sidebar entry (board, epics,
 * releases) are in General > Capabilities since #Q2565. The board's columns,
 * the tag colours (#Q4061) and the prompts have tabs of their own.
 */
const ProjectSettingsWorkPage = () => {
  const shell = useInject(ProjectShellRegistry);

  return (
    <div className="flex flex-col gap-4">
      <ProjectSettingsCapabilitySection
        capability="plan"
        master={false}
        options={shell.settingsOptions("plan")}
      />
    </div>
  );
};

export default ProjectSettingsWorkPage;
