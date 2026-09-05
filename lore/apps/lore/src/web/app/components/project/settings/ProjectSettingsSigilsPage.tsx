import { settingsCardEdge } from "@alepha/ui/components/settings/settings-card-edge.ts";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { cn } from "@alepha/ui/lib/utils";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Ban, Plus } from "lucide-react";
import { useState } from "react";

import type { SigilController } from "@/api/controllers/SigilController.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "@/web/app/atoms/currentProjectMemberAtom.ts";
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
  const sigilApi = useClient<SigilController>();
  const [project] = useStore(currentProjectAtom);
  const [member] = useStore(currentProjectMemberAtom);
  const isOwner = member?.owner ?? false;
  // ⚠️ Its own read since Apps v3 (#1768), where it used to share
  // `currentSigilsAtom` with the sidebar. That atom is `currentInstancesAtom`
  // now and holds instances, which is a different thing: a sigil is an unlock
  // on one, and this page still lists credentials. The page is gutted by #1770,
  // so the list is kept alive on a query of its own rather than rewired to a
  // shape it is about to stop rendering.
  const [rulesOpen, setRulesOpen] = useState(false);

  const master = useProjectFeatureToggle("sigils");
  const enabled = master.enabled;

  const [enrolling, setEnrolling] = useState(false);
  /**
   * The one moment a token is readable. Cleared as soon as it is dismissed.
   */
  const [freshToken, setFreshToken] = useState<string | undefined>();

  const { data, refetch, error } = useQuery(
    {
      enabled: Boolean(project) && enabled,
      key: ["settings-sigils", project?.id],
      handler: async () => {
        if (!project) return undefined;
        return await sigilApi.listSigils({ params: { projectId: project.id } });
      },
    },
    [project?.id, enabled],
  );
  const sigils = data?.items;

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
              `?? []` covers the first render, before the query resolves. The
              empty message is therefore the true one everywhere except that
              one frame.
            */}
            {/*
              A failed read is not an empty list, and rendering it as one would
              claim a project has no apps on the strength of a transient
              failure - the same distinction `currentInstancesAtom` draws.
            */}
            {error ? (
              <CardContent className="px-4 py-6">
                <span className="text-destructive text-sm">
                  {error.message}
                </span>
              </CardContent>
            ) : (
              (sigils ?? []).length === 0 && (
                <CardContent className="px-4 py-6">
                  <span className="text-muted-foreground text-sm">
                    {tr("sigils.empty")}
                  </span>
                </CardContent>
              )
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
            onEnrolled={(token) => {
              setFreshToken(token);
              // The dialog no longer writes a shared atom, so the list is
              // refetched here instead. One extra read on a rare action, and
              // the page cannot show a list the dialog just made stale.
              void refetch();
            }}
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
