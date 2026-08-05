import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import ProjectUpdate from "../ProjectUpdate.tsx";
import ProjectSettingsDangerZoneSection from "./ProjectSettingsDangerZoneSection.tsx";
import ProjectSettingsDataSection from "./ProjectSettingsDataSection.tsx";

const ProjectSettingsGeneralPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);

  if (!project) {
    return null;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="text-sm">{tr("project.settings.general.title")}</span>
        <ProjectUpdate project={project} />
      </div>

      <ProjectSettingsDataSection />

      <ProjectSettingsDangerZoneSection />
    </div>
  );
};

export default ProjectSettingsGeneralPage;
