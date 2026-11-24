import { ProjectSettingsCapabilitySection } from "@lore/core/web";

/**
 * Plan > Requirements (#Q4259): what Requirements changes about the rest of
 * Plan, listed while the `requirements` option is on. Today one switch,
 * "Block a release on a failing Must", out of the Quests tab where it sat
 * disabled for every project without Requirements.
 */
const ProjectSettingsRequirementsPage = () => (
  <div className="flex flex-col gap-4">
    <ProjectSettingsCapabilitySection
      capability="plan"
      master={false}
      options={["blockFailingMust"]}
    />
  </div>
);

export default ProjectSettingsRequirementsPage;
