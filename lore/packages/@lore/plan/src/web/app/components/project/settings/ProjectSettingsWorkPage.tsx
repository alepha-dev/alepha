import {
  ProjectShellRegistry,
  ProjectSettingsCapabilitySection,
} from "@lore/core/web";
import { useInject } from "alepha/react";

/**
 * Plan > Quests ("Features" until #Q4258): how quests behave.
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
        // "Block a release on a failing Must" is the Requirements tab's
        // (#Q4259), listed only while Requirements is on.
        options={shell
          .settingsOptions("plan")
          .filter((option) => option !== "blockFailingMust")}
      />
    </div>
  );
};

export default ProjectSettingsWorkPage;
