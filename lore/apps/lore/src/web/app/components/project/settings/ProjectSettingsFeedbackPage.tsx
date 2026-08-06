import ProjectSettingsFeatureSection from "./ProjectSettingsFeatureSection.tsx";
import { useProjectFeatureToggle } from "./useProjectFeatureToggle.ts";

/**
 * The Feedback module switch.
 *
 * It lived on the Sigils page while the per-app capabilities did, which read as
 * though it were one of them. It is not: the same flag gates the first-party
 * form at `/p/:projectId/request` and the owner's inbox, both of which work with
 * no app enrolled at all. An app's own Feedback capability — whether *that*
 * app's widget may submit — is on its Settings tab.
 */
const ProjectSettingsFeedbackPage = () => {
  const { enabled, toggle } = useProjectFeatureToggle("feedback");
  return (
    <ProjectSettingsFeatureSection
      featureKey="feedback"
      enabled={enabled}
      onToggle={toggle}
    />
  );
};

export default ProjectSettingsFeedbackPage;
