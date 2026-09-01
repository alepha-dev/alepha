import ProjectSettingsFeatureSection from "./ProjectSettingsFeatureSection.tsx";
import ProjectSettingsRoadmapSection from "./ProjectSettingsRoadmapSection.tsx";
import { useProjectFeatureToggle } from "./useProjectFeatureToggle.ts";

/**
 * Releases settings: the module toggle, and who may read the roadmap.
 *
 * It used to carry a second control, the auto-close cadence that computed a
 * milestone's `closesAt`. Nothing closes on a timer any more, so the control
 * went with the recorder.
 *
 * The roadmap card lives here rather than on a page of its own because the
 * roadmap is the release plan rendered for a reader who does not use Lore
 * daily - there is nothing to configure about it that is not a fact about
 * releases. It is deliberately NOT gated on the module toggle above: a
 * project that turns Releases off has no roadmap to publish, but hiding the
 * control would also hide the fact that a roadmap is still public.
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
      <ProjectSettingsRoadmapSection />
    </div>
  );
};

export default ProjectSettingsReleasesPage;
