import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { SigilController } from "@/api/controllers/SigilController.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "@/web/app/atoms/currentProjectMemberAtom.ts";
import { currentSigilsAtom } from "@/web/app/atoms/currentSigilsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import TokenReveal from "../../shared/TokenReveal.tsx";
import ProjectSettingsFeatureSection from "./ProjectSettingsFeatureSection.tsx";
import ProjectSettingsSigilRow from "./ProjectSettingsSigilRow.tsx";
import ProjectSettingsToggleRow from "./ProjectSettingsToggleRow.tsx";
import { useProjectFeatureToggle } from "./useProjectFeatureToggle.ts";

/**
 * Which applications report into this project, and what they may report.
 *
 * A sigil is **one app** — a name and the token that name reports with — so the
 * form asks for one thing. How finely an operator slices their world is left to
 * them: an app that wants staging kept apart from production enrols two sigils
 * and names them so.
 *
 * The token appears exactly once, at creation. It is stored hashed, so nothing
 * can show it again. The way back from a lost or leaked token is to rotate it —
 * offered on the app's own Settings tab, beside delete, because the difference
 * between the two is the whole point: the aggregate tables cascade, so deleting
 * a sigil to revoke a token also erases everything that app ever reported.
 *
 * This page enrols and lists; each row links to the app it names.
 *
 * Enrolling is owner-only server-side (`$secure` + `assertOwner`), same as
 * rotate/delete on the app's own Settings tab. The form is disabled here for
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

  const master = useProjectFeatureToggle("sigils");
  // What the ingest endpoint accepts, project-wide. Intersected with each
  // sigil's own `kinds` — these are the lever an operator actually reaches for.
  const feedback = useProjectFeatureToggle("feedback");
  const blights = useProjectFeatureToggle("blights");
  const beacon = useProjectFeatureToggle("beacon");
  const vitals = useProjectFeatureToggle("vitals");

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  /** The one moment a token is readable. Cleared as soon as it is dismissed. */
  const [freshToken, setFreshToken] = useState<string | undefined>();

  const enabled = master.enabled;

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

  const create = async () => {
    if (!project || !name.trim()) return;
    setBusy(true);
    try {
      const created = await sigilApi.createSigil({
        params: { projectId: project.id },
        body: { name: name.trim() },
      });
      setFreshToken(created.token);
      setName("");
      toaster.success(tr("sigils.toast.created"));
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!project) return null;

  return (
    <div className="flex flex-col gap-6">
      <ProjectSettingsFeatureSection
        featureKey="sigils"
        enabled={enabled}
        onToggle={master.toggle}
      />

      {enabled && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">
              {tr("sigils.features.title")}
            </span>
            <span className="text-muted-foreground text-xs">
              {tr("sigils.features.subtitle")}
            </span>
          </div>

          <Card className="bg-card divide-y gap-0 rounded-lg border py-0">
            <ProjectSettingsToggleRow
              title={tr("feedback.feature.title")}
              description={tr("feedback.feature.description")}
              toggle={feedback}
            />
            <ProjectSettingsToggleRow
              title={tr("blights.feature.title")}
              description={tr("blights.feature.description")}
              toggle={blights}
            />
            <ProjectSettingsToggleRow
              title={tr("beacon.feature.title")}
              description={tr("beacon.feature.description")}
              toggle={beacon}
            />
            <ProjectSettingsToggleRow
              title={tr("vitals.feature.title")}
              description={tr("vitals.feature.description")}
              toggle={vitals}
            />
          </Card>
        </div>
      )}

      {enabled && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{tr("sigils.title")}</span>
            <span className="text-muted-foreground text-xs">
              {tr("sigils.subtitle")}
            </span>
          </div>

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

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={name}
              aria-label={tr("sigils.create.name")}
              placeholder={tr("sigils.create.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
              disabled={!isOwner}
            />
            {isOwner ? (
              <Button
                onClick={() => void create()}
                disabled={busy || !name.trim()}
              >
                <Plus />
                {tr("sigils.create.submit")}
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button disabled aria-label={tr("sigils.create.submit")} />
                  }
                >
                  <Plus />
                  {tr("sigils.create.submit")}
                </TooltipTrigger>
                <TooltipContent>{tr("sigils.create.ownerOnly")}</TooltipContent>
              </Tooltip>
            )}
          </div>

          <Card className="bg-card divide-y gap-0 rounded-lg border py-0">
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
        </div>
      )}
    </div>
  );
};

export default ProjectSettingsSigilsPage;
