import { Button } from "@alepha/ui";
import { SettingsRow, SettingsSection } from "@alepha/ui/settings";
import {
  currentProjectAtom,
  ProjectShellRegistry,
  type I18n,
  hasCapability,
  ProjectSettingsCapabilitySection,
} from "@lore/core/web";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Ban } from "lucide-react";
import { useState } from "react";

import ProjectErrorRulesDialog from "../errors/ProjectErrorRulesDialog.tsx";
import ProjectSettingsCoverageTarget from "./ProjectSettingsCoverageTarget.tsx";

/**
 * Two blocks: the module switch and the ignore rules.
 *
 * The default environment was a third until #Q2135. It was project-wide while
 * the question it answered is per app, so a project set to `production` with
 * an app whose only copy is `preview` held a setting that could only ever be
 * wrong - and it outranked the single place that app could go. The CLI reads
 * the app's own rows now, and `defaultAppInstance` is back to its fixed rule.
 *
 * ## What left, and why nothing replaced it
 *
 * This page used to enrol apps and list their credentials. Both are gone
 * (#1770). Creating a deployed copy is what `/apps` is for, and a list of the
 * same things in Settings is a second door onto one room - the shape that had
 * an operator wondering which of the two was authoritative. The credential's
 * own controls (token prefix, rotate, remove) followed the credential down to
 * the instance that holds it, where the analytics they would destroy are also
 * shown.
 *
 * ## The key finally matches the label
 *
 * This page was `projectSettingsSigils` at `/settings/sigils`, writing
 * `features.sigils`, while every label on it said Apps - because a key inside
 * `projects.features` could not be renamed without every project that had the
 * module on silently losing it. Moving the storage to a row of its own is what
 * let the name move: the capability is `apps`, and `track` is the option that
 * carries what `sigils` actually gated.
 *
 * ## ⚠️ Ignore rules are why this page survives at all
 *
 * `projectErrorIgnoreRules` is project-scoped **on purpose**: one rule mutes a noisy
 * error across every app the project owns, so it cannot follow a sigil down to
 * an instance. There is no Errors entry in the settings nav, which is how this
 * control landed here in the first place; errors arrive from apps, so the Apps
 * page is a defensible home. Giving Errors its own settings page is the
 * cleaner taxonomy and is deliberately not in this epic.
 */
const ProjectSettingsAppsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [rulesOpen, setRulesOpen] = useState(false);
  const shell = useInject(ProjectShellRegistry);

  const enabled = hasCapability(project, "ship");

  if (!project) return null;

  return (
    <div className="flex flex-col gap-6">
      {/* The master is in General > Capabilities since #Q2565, with every
          option that adds a sidebar entry. `uptime` adds one (Uptime) and is
          listed here too, as Monitor apps beside Track and Deploy (#Q3597):
          it is the third thing a project does with its apps, and a reader
          looking for it looks here. Both switches write the same row.
          `stacks` stays in General only. */}
      <ProjectSettingsCapabilitySection
        capability="ship"
        master={false}
        options={[...shell.settingsOptions("ship"), "uptime"]}
      />

      {enabled && <ProjectSettingsCoverageTarget />}

      {enabled && (
        <div className="flex flex-col gap-2">
          {/* Ignore rules used to be a toolbar action on the Errors inbox.
              They are standing configuration, not triage: the inbox is where
              you decide about one failure that already happened, and a rule
              decides what never lands at all. The move also fixes a
              permissions mismatch — rule mutations are owner-only
              server-side, so a member could open the dialog from the inbox
              only to be refused. Keep this owner-facing; do not re-expose it
              on the inbox. */}
          {/* A `SettingsSection` like the capability rows above, so the
              three cards of this page share one edge (#Q3373). */}
          <SettingsSection>
            <SettingsRow
              label={tr("errors.rules.title")}
              description={tr("errors.rules.settingsDescription")}
            >
              <Button variant="outlined" onClick={() => setRulesOpen(true)}>
                <Ban className="size-4" />
                {tr("errors.rules.manage")}
              </Button>
            </SettingsRow>
          </SettingsSection>

          <ProjectErrorRulesDialog
            open={rulesOpen}
            projectId={project.id}
            onOpenChange={setRulesOpen}
          />
        </div>
      )}
    </div>
  );
};

export default ProjectSettingsAppsPage;
