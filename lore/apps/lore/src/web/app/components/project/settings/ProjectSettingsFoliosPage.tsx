import ProjectSettingsFeatureSection from "./ProjectSettingsFeatureSection.tsx";
import { useProjectFeatureToggle } from "./useProjectFeatureToggle.ts";

const ProjectSettingsFoliosPage = () => {
  const { enabled, toggle } = useProjectFeatureToggle("folios");
  return (
    <ProjectSettingsFeatureSection
      featureKey="folios"
      enabled={enabled}
      onToggle={toggle}
    />
  );
};

export default ProjectSettingsFoliosPage;
