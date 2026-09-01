import ProjectSettingsFeatureSection from "./ProjectSettingsFeatureSection.tsx";
import { useProjectFeatureToggle } from "./useProjectFeatureToggle.ts";

/**
 * Quality module settings: the `features.quality` switch and nothing else.
 *
 * The switch gates the Reports Quality TAB only. `QualityController` accepts a
 * push whatever it says, so turning this off hides a history that keeps being
 * written, and turning it on reveals whatever CI has pushed since. That second
 * half is the point: the flag is absent from every project's defaults, and
 * until this page existed nothing in the UI could set it, so a project could
 * receive a run a day and show none of them.
 *
 * Its own sub-page for the reason `ProjectSettingsEpicsPage` gives: every
 * feature switch carries the same generic `aria-label` ("Enable"), and one
 * switch per page is what keeps that accessible name unambiguous.
 */
const ProjectSettingsQualityPage = () => {
  const { enabled, toggle } = useProjectFeatureToggle("quality");

  return (
    <div className="flex flex-col gap-4">
      <ProjectSettingsFeatureSection
        featureKey="quality"
        enabled={enabled}
        onToggle={toggle}
      />
    </div>
  );
};

export default ProjectSettingsQualityPage;
