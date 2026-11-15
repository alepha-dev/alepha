import { useInject } from "alepha/react";

import { CAPABILITY_KEYS } from "../../../../../api/schemas/capabilityKeySchema.ts";
import { ProjectShellRegistry } from "../../../registries/ProjectShellRegistry.ts";
import ProjectSettingsCapabilitySection from "./ProjectSettingsCapabilitySection.tsx";

/**
 * General > Capabilities: every switch that adds or removes a sidebar entry.
 *
 * Each capability's master, with the options a sidebar entry hangs off
 * nested under it (epics, releases, track). The options that only
 * change how a capability behaves stay on its own settings page.
 *
 * Ship is the exception (#Q3702): its own Features page holds no switch
 * any more, so every Ship option is listed here, Monitor apps included,
 * rather than the same rows twice.
 *
 * ⚠️ The masters live HERE and nowhere else (#Q2565). A capability that is
 * off leaves the sidebar, its settings section included, so the page that
 * turns it back on must be one that is always listed. General is.
 */
const ProjectSettingsCapabilitiesPage = () => {
  const shell = useInject(ProjectShellRegistry);

  return (
    <div className="flex flex-col gap-4">
      {CAPABILITY_KEYS.map((key) => (
        <ProjectSettingsCapabilitySection
          key={key}
          capability={key}
          options={
            key === "ship"
              ? [...shell.navOptions(key), ...shell.settingsOptions(key)]
              : shell.navOptions(key)
          }
        />
      ))}
    </div>
  );
};

export default ProjectSettingsCapabilitiesPage;
