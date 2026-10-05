import { useInject, useStore } from "alepha/react";

import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { ProjectShellRegistry } from "@/web/app/registries/ProjectShellRegistry.ts";

import ProjectUpdate from "../ProjectUpdate.tsx";
import ProjectSettingsDangerZoneSection from "./ProjectSettingsDangerZoneSection.tsx";

const ProjectSettingsGeneralPage = () => {
  const [project] = useStore(currentProjectAtom);
  const shell = useInject(ProjectShellRegistry);

  if (!project) {
    return null;
  }

  return (
    <div className="flex flex-col gap-8">
      {/* The heading is the AutoForm group's own now, so this page no longer
          wraps the form to put one above it. */}
      <ProjectUpdate project={project} />

      {/* Cards a module adds here (Work's quest export), #E75 #Q2624. */}
      {shell.settingsPanels("general").map((panel) => (
        <panel.component key={panel.key} />
      ))}

      <ProjectSettingsDangerZoneSection />
    </div>
  );
};

export default ProjectSettingsGeneralPage;
