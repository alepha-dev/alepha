import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Ban } from "lucide-react";
import { useState } from "react";

import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import { hasCapability } from "@/web/app/services/projectCapabilities.ts";

import ProjectBlightRulesDialog from "../blights/ProjectBlightRulesDialog.tsx";
import ProjectSettingsCapabilitySection from "./ProjectSettingsCapabilitySection.tsx";

/**
 * Two blocks: the module switch, and the ignore rules.
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
 * `blightIgnoreRules` is project-scoped **on purpose**: one rule mutes a noisy
 * error across every app the project owns, so it cannot follow a sigil down to
 * an instance. There is no Blights entry in the settings nav, which is how this
 * control landed here in the first place; blights arrive from apps, so the Apps
 * page is a defensible home. Giving Blights its own settings page is the
 * cleaner taxonomy and is deliberately not in this epic.
 */
const ProjectSettingsAppsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [rulesOpen, setRulesOpen] = useState(false);

  const enabled = hasCapability(project, "apps");

  if (!project) return null;

  return (
    <div className="flex flex-col gap-6">
      <ProjectSettingsCapabilitySection capability="apps" />

      {enabled && (
        <div className="flex flex-col gap-2">
          {/* Ignore rules used to be a toolbar action on the Blights inbox.
              They are standing configuration, not triage: the inbox is where
              you decide about one failure that already happened, and a rule
              decides what never lands at all. The move also fixes a
              permissions mismatch — rule mutations are owner-only
              server-side, so a member could open the dialog from the inbox
              only to be refused. Keep this owner-facing; do not re-expose it
              on the inbox. */}
          <Card className="py-4 shadow">
            <CardContent className="flex flex-col gap-3 px-4 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {tr("blights.rules.title")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {tr("blights.rules.settingsDescription")}
                </span>
              </div>
              <div className="flex justify-start sm:justify-end">
                <Button variant="outline" onClick={() => setRulesOpen(true)}>
                  <Ban className="size-4" />
                  {tr("blights.rules.manage")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <ProjectBlightRulesDialog
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
