import { CAPABILITY_KEYS } from "@/api/schemas/capabilityKeySchema.ts";

import { CAPABILITY_NAV_OPTIONS } from "../capabilityNav.ts";
import ProjectSettingsCapabilitySection from "./ProjectSettingsCapabilitySection.tsx";

/**
 * General > Capabilities: every switch that adds or removes a sidebar entry.
 *
 * Each capability's master, with the options a sidebar entry hangs off
 * nested under it (board, epics, releases, track). The options that only
 * change how a capability behaves stay on its own settings page.
 *
 * ⚠️ The masters live HERE and nowhere else (#Q2565). A capability that is
 * off leaves the sidebar, its settings section included, so the page that
 * turns it back on must be one that is always listed. General is.
 */
const ProjectSettingsCapabilitiesPage = () => (
  <div className="flex flex-col gap-4">
    {CAPABILITY_KEYS.map((key) => (
      <ProjectSettingsCapabilitySection
        key={key}
        capability={key}
        options={CAPABILITY_NAV_OPTIONS[key]}
      />
    ))}
  </div>
);

export default ProjectSettingsCapabilitiesPage;
