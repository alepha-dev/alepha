import ProjectSettingsFeatureSection from "./ProjectSettingsFeatureSection.tsx";
import { useProjectFeatureToggle } from "./useProjectFeatureToggle.ts";

/**
 * Releases settings: the module toggle, and nothing else.
 *
 * It used to carry a second control, the auto-close cadence that computed a
 * milestone's `closesAt`. Nothing closes on a timer any more, so the control
 * went with the recorder. The toggle is a legitimate page on its own — every
 * other module has exactly this page.
 *
 * ⚠️ The persisted feature key is `milestones`, not `releases`. It is a
 * REQUIRED key inside the `projects.features` JSON column and renaming it
 * fails every project read; see `projectFeaturesSchema`.
 */
const ProjectSettingsReleasesPage = () => {
  const { enabled, toggle } = useProjectFeatureToggle("milestones");

  return (
    <div className="flex flex-col gap-4">
      <ProjectSettingsFeatureSection
        featureKey="milestones"
        enabled={enabled}
        onToggle={toggle}
      />
    </div>
  );
};

export default ProjectSettingsReleasesPage;
