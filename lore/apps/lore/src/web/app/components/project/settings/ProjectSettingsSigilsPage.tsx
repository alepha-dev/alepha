import { settingsCardEdge } from "@alepha/ui/components/settings/settings-card-edge.ts";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { cn } from "@alepha/ui/lib/utils";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Ban, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { SigilController } from "@/api/controllers/SigilController.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "@/web/app/atoms/currentProjectMemberAtom.ts";
import { currentSigilsAtom } from "@/web/app/atoms/currentSigilsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import TokenReveal from "../../shared/TokenReveal.tsx";
import ProjectBlightRulesDialog from "../blights/ProjectBlightRulesDialog.tsx";
import ProjectSettingsFeatureSection from "./ProjectSettingsFeatureSection.tsx";
import ProjectSettingsSigilRow from "./ProjectSettingsSigilRow.tsx";
import ProjectSettingsSigilsEnrollDialog from "./ProjectSettingsSigilsEnrollDialog.tsx";
import { useProjectFeatureToggle } from "./useProjectFeatureToggle.ts";

/**
 * Which applications report into this project.
 *
 * A sigil is **one app** — a name and the token that name reports with — so the
 * dialog asks for one thing. How finely an operator slices their world is left
 * to them: an app that wants staging kept apart from production enrols two
 * sigils and names them so.
 *
 * The token appears exactly once, at creation. It is stored hashed, so nothing
 * can show it again. The way back from a lost or leaked token is to rotate it —
 * offered on the app's own Settings tab, beside delete, because the difference
 * between the two is the whole point: the aggregate tables cascade, so deleting
 * a sigil to revoke a token also erases everything that app ever reported.
 *
 * What each app is *allowed* to report used to live here as a project-wide
 * Capabilities card. It is per-app now, on that app's Settings tab — a project
 * flag meant silencing a noisy staging deployment silenced production with it.
 *
 * This page enrols and lists; each row links to the app it names.
 *
 * Enrolling is owner-only server-side (`$secure` + `assertOwner`), same as
 * rotate/delete on the app's own Settings tab. The button is disabled here for
 * a non-owner, with a tooltip explaining why — a UX hint over
 * `currentProjectMemberAtom.owner`, not a second authorization boundary. See
 * the longer note on `AppSettings.tsx`.
 */
const ProjectSettingsSigilsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const sigilApi = useClient<SigilController>();
  const [project] = useStore(currentProjectAtom);
  const [member] = useStore(currentProjectMemberAtom);
  const isOwner = member?.owner ?? false;
  // Shared with the sidebar's Apps section: enrolling here has to make the app
  // appear there without a reload, and this page's own successful `reload()`
  // repairs a sidebar whose read failed during the project load.
  const [sigils, setSigils] = useStore(currentSigilsAtom);
  const [rulesOpen, setRulesOpen] = useState(false);

  const master = useProjectFeatureToggle("sigils");
  const enabled = master.enabled;

  const [enrolling, setEnrolling] = useState(false);
  /**
   * The one moment a token is readable. Cleared as soon as it is dismissed.
   */
  const [freshToken, setFreshToken] = useState<string | undefined>();

  const reload = useCallback(async () => {
    if (!project) return;
    try {
      const res = await sigilApi.listSigils({
        params: { projectId: project.id },
      });
      setSigils(res.items);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  }, [project, sigilApi, setSigils]);

  useEffect(() => {
    if (project && enabled) {
      void reload();
    }
  }, [project, enabled, reload]);

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
          <span className="text-sm">{tr("sigils.title")}</span>

          {freshToken && (
            <TokenReveal
              token={freshToken}
              title={tr("sigils.token.title")}
              copyLabel={tr("sigils.token.copy")}
              doneLabel={tr("sigils.token.done")}
              copiedMessage={tr("sigils.toast.copied")}
              onDismiss={() => setFreshToken(undefined)}
            />
          )}

          <Card className={cn(settingsCardEdge, "gap-0 divide-y py-0")}>
            <CardContent className="flex flex-col gap-3 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {tr("sigils.create.title")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {tr("sigils.create.subtitle")}
                </span>
              </div>
              <div className="flex justify-start sm:justify-end">
                {isOwner ? (
                  <Button onClick={() => setEnrolling(true)}>
                    <Plus className="size-4" />
                    {tr("sigils.create.submit")}
                  </Button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          disabled
                          aria-label={tr("sigils.create.submit")}
                        />
                      }
                    >
                      <Plus className="size-4" />
                      {tr("sigils.create.submit")}
                    </TooltipTrigger>
                    <TooltipContent>
                      {tr("sigils.create.ownerOnly")}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </CardContent>

            {/*
              `?? []` is the sidebar's could-not-load state. This page always
              runs its own `reload()`, which either fills the atom or toasts the
              failure, so the empty message here is only ever the true one.
            */}
            {(sigils ?? []).length === 0 && (
              <CardContent className="px-4 py-6">
                <span className="text-muted-foreground text-sm">
                  {tr("sigils.empty")}
                </span>
              </CardContent>
            )}
            {(sigils ?? []).map((sigil) => (
              <ProjectSettingsSigilRow key={sigil.id} sigil={sigil} />
            ))}
          </Card>

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

          <ProjectSettingsSigilsEnrollDialog
            open={enrolling}
            onOpenChange={setEnrolling}
            onEnrolled={setFreshToken}
          />

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
