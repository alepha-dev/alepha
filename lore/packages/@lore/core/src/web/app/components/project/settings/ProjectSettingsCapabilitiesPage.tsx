import { SettingsSection } from "@alepha/ui/settings";
import { useInject } from "alepha/react";

import {
  CAPABILITY_KEYS,
  GENERAL_CAPABILITY_KEYS,
} from "../../../../../api/schemas/capabilityKeySchema.ts";
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
 * rather than the same rows twice. Reports has no settings page of its own,
 * so its one option, Quality (#Q4217), is listed here too.
 *
 * The page opens with Activity, Chat and Reports (#Q4007), three switches
 * in one card above the pillars, with no heading of its own (#Q4046): the
 * tab already sits under General, a "General" label repeated it.
 *
 * ⚠️ The masters live HERE and nowhere else (#Q2565). A capability that is
 * off leaves the sidebar, its settings section included, so the page that
 * turns it back on must be one that is always listed. General is.
 */
const ProjectSettingsCapabilitiesPage = () => {
  const shell = useInject(ProjectShellRegistry);
  const general: readonly string[] = GENERAL_CAPABILITY_KEYS;

  return (
    <div className="flex flex-col gap-4">
      <SettingsSection id="general">
        {GENERAL_CAPABILITY_KEYS.map((key) => (
          <ProjectSettingsCapabilitySection
            key={key}
            capability={key}
            // Reports lists its Quality option, which adds no sidebar entry.
            options={key === "reports" ? undefined : shell.navOptions(key)}
            bare
          />
        ))}
      </SettingsSection>
      {CAPABILITY_KEYS.filter((key) => !general.includes(key)).map((key) => (
        <ProjectSettingsCapabilitySection
          key={key}
          capability={key}
          // Ship lists every option, in the registry's order (#Q4006):
          // omitted means all of them, as declared.
          options={key === "ship" ? undefined : shell.navOptions(key)}
        />
      ))}
    </div>
  );
};

export default ProjectSettingsCapabilitiesPage;
