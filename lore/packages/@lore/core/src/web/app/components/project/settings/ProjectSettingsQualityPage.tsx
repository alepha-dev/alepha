import ProjectSettingsCoverageTarget from "./ProjectSettingsCoverageTarget.tsx";
import { default as ProjectSettingsThreshold } from "./ProjectSettingsThreshold.tsx";

/**
 * General > Quality (#Q4059): the coverage target the Quality report draws,
 * and the coverage alert. They sat on Ship's Features tab until Quality
 * moved to Build (#E162); Build has no settings section of its own, so the
 * tab is General's, listed while Build's `quality` option is on.
 */
const ProjectSettingsQualityPage = () => (
  <div className="flex flex-col gap-6">
    <ProjectSettingsCoverageTarget />
    <ProjectSettingsThreshold kind="coverage" />
  </div>
);

export default ProjectSettingsQualityPage;
