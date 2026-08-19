import ProjectSettingsFeatureSection from "./ProjectSettingsFeatureSection.tsx";
import { useProjectFeatureToggle } from "./useProjectFeatureToggle.ts";

/**
 * Epics module settings.
 *
 * Exists as its own sub-page rather than as a section injected into the
 * settings shell, because every feature switch carries the same generic
 * `aria-label` ("Enable"). Two of them on one page is a strict-mode
 * ambiguity for `getByRole("switch", { name: /enable/i })` — which is
 * exactly how a shell-hosted version broke the pre-existing
 * `settings-features`, `project-wizard` and `sigil` e2e specs. One switch
 * per page is what keeps that accessible name unambiguous.
 */
const ProjectSettingsEpicsPage = () => {
  const { enabled, toggle } = useProjectFeatureToggle("epics");

  return (
    <div className="flex flex-col gap-4">
      <ProjectSettingsFeatureSection
        featureKey="epics"
        enabled={enabled}
        onToggle={toggle}
      />
    </div>
  );
};

export default ProjectSettingsEpicsPage;
