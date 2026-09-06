import ProjectSettingsCapabilitySection from "./ProjectSettingsCapabilitySection.tsx";

/**
 * Support: the capability, and nothing else yet.
 *
 * It gates the first-party form at `/:projectSlug/request` and the owner's
 * inbox, both of which work with no app enrolled at all - which is why it is
 * a capability of its own rather than something inside Apps. An app's own
 * `feedback` kind, whether THAT app's widget may submit, is on its Settings
 * tab, and needs `apps.track` as well as this: a capability may read another's
 * state to narrow what it does, never to widen it.
 *
 * ⚠️ **"A public request page" is the obvious first option and is
 * deliberately absent.** `/:projectSlug/request` is a public URL some owners
 * will not want, so the switch is real and worth having - but it does not
 * exist, and adding a feature to fill a slot on a settings page is the wrong
 * order.
 */
const ProjectSettingsSupportPage = () => (
  <ProjectSettingsCapabilitySection capability="support" />
);

export default ProjectSettingsSupportPage;
