import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Ban } from "lucide-react";
import { useState } from "react";

import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ProjectBlightRulesDialog from "../blights/ProjectBlightRulesDialog.tsx";
import ProjectSettingsFeatureSection from "./ProjectSettingsFeatureSection.tsx";
import { useProjectFeatureToggle } from "./useProjectFeatureToggle.ts";

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
 * ## ⚠️ The route name and path did NOT move
 *
 * `projectSettingsSigils` at `/settings/sigils`, unchanged. `$page` renames are
 * not typecheck-protected and `ProjectSettings.tsx`'s nav array carries the
 * name as a plain string; moving this route once crashed every settings page.
 * Only the nav label and the head title read "Apps".
 *
 * ## ⚠️ The persisted key is still `features.sigils`
 *
 * Relabelled, never renamed. The key is `z.boolean().optional()`, so unlike the
 * 2026-08-05 `projects.features` incident a rename would not fail to decode -
 * it would do something quieter and just as damaging: every project that had
 * Apps ON reads `undefined` for the new key and silently loses the feature,
 * with the old value still sitting in the JSON column. Exactly the
 * `features.milestones` situation, which has said "Releases" in the UI since
 * 2026-08-30 and `milestones` on disk throughout.
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
const ProjectSettingsSigilsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [rulesOpen, setRulesOpen] = useState(false);

  const master = useProjectFeatureToggle("sigils");
  const enabled = master.enabled;

  if (!project) return null;

  return (
    <div className="flex flex-col gap-6">
      <ProjectSettingsFeatureSection
        featureKey="sigils"
        enabled={enabled}
        onToggle={master.toggle}
      />

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

export default ProjectSettingsSigilsPage;
