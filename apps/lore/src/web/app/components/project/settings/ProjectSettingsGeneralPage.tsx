import { useStore } from "alepha/react";

import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";

import ProjectUpdate from "../ProjectUpdate.tsx";
import ProjectSettingsDangerZoneSection from "./ProjectSettingsDangerZoneSection.tsx";
import ProjectSettingsDataSection from "./ProjectSettingsDataSection.tsx";

const ProjectSettingsGeneralPage = () => {
  const [project] = useStore(currentProjectAtom);

  if (!project) {
    return null;
  }

  return (
    <div className="flex flex-col gap-8">
      {/* The heading is the AutoForm group's own now, so this page no longer
          wraps the form to put one above it. */}
      <ProjectUpdate project={project} />

      <ProjectSettingsDataSection />

      <ProjectSettingsDangerZoneSection />
    </div>
  );
};

export default ProjectSettingsGeneralPage;
