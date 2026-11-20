import { SettingsSection } from "@alepha/ui/settings";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import {
  CAPABILITY_KEYS,
  GENERAL_CAPABILITY_KEYS,
} from "../../../../../api/schemas/capabilityKeySchema.ts";
import { ProjectShellRegistry } from "../../../registries/ProjectShellRegistry.ts";
import type { I18n } from "../../../services/I18n.ts";
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
 * rather than the same rows twice. Build has no settings page of its own,
 * so its two options, Repositories and Quality, are listed here too (#Q4005).
 *
 * The page opens with General (#Q4007): Activity, Chat and Reports, three
 * switches in one card, above the pillars.
 *
 * ⚠️ The masters live HERE and nowhere else (#Q2565). A capability that is
 * off leaves the sidebar, its settings section included, so the page that
 * turns it back on must be one that is always listed. General is.
 */
const ProjectSettingsCapabilitiesPage = () => {
  const shell = useInject(ProjectShellRegistry);
  const { tr } = useI18n<I18n, "en">();
  const general: readonly string[] = GENERAL_CAPABILITY_KEYS;

  return (
    <div className="flex flex-col gap-4">
      <SettingsSection
        id="general"
        title={tr("project.settings.capabilities.general")}
      >
        {GENERAL_CAPABILITY_KEYS.map((key) => (
          <ProjectSettingsCapabilitySection
            key={key}
            capability={key}
            options={shell.navOptions(key)}
            bare
          />
        ))}
      </SettingsSection>
      {CAPABILITY_KEYS.filter((key) => !general.includes(key)).map((key) => (
        <ProjectSettingsCapabilitySection
          key={key}
          capability={key}
          options={
            key === "ship" || key === "build"
              ? [...shell.navOptions(key), ...shell.settingsOptions(key)]
              : shell.navOptions(key)
          }
        />
      ))}
    </div>
  );
};

export default ProjectSettingsCapabilitiesPage;
