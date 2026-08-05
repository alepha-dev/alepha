import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  SigilController,
  SigilResource,
} from "@/api/controllers/SigilController.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import ProjectSettingsFeatureSection from "./ProjectSettingsFeatureSection.tsx";
import ProjectSettingsSigilRow from "./ProjectSettingsSigilRow.tsx";
import ProjectSettingsToggleRow from "./ProjectSettingsToggleRow.tsx";
import ProjectSettingsTokenReveal from "./ProjectSettingsTokenReveal.tsx";
import { useProjectFeatureToggle } from "./useProjectFeatureToggle.ts";

/**
 * Which applications report into this project, and what they may report.
 *
 * A sigil is **one environment of one application** — `lore` in `production` is
 * a different sigil from `lore` in `staging`, so the form asks for the two
 * separately instead of a free-form name that would let the same environment be
 * enrolled twice under different spellings.
 *
 * The token appears exactly once, at creation. It is stored hashed, so nothing
 * can show it again. The way back from a lost or leaked token is to rotate it,
 * which is offered beside delete precisely because delete is not the same
 * thing: the aggregate tables cascade, so deleting a sigil to revoke a token
 * also erases everything that environment ever reported.
 */
const ProjectSettingsSigilsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const sigilApi = useClient<SigilController>();
  const [project] = useStore(currentProjectAtom);

  const master = useProjectFeatureToggle("sigils");
  // What the ingest endpoint accepts, project-wide. Intersected with each
  // sigil's own `kinds` — these are the lever an operator actually reaches for.
  const feedback = useProjectFeatureToggle("feedback");
  const blights = useProjectFeatureToggle("blights");
  const beacon = useProjectFeatureToggle("beacon");
  const vitals = useProjectFeatureToggle("vitals");

  const [sigils, setSigils] = useState<SigilResource[]>([]);
  const [app, setApp] = useState("");
  const [environment, setEnvironment] = useState("");
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
  }, [project, sigilApi]);

  useEffect(() => {
    if (project && enabled) {
      void reload();
    }
  }, [project, enabled, reload]);

  const create = async () => {
    if (!project || !app.trim() || !environment.trim()) return;
    setBusy(true);
    try {
      const created = await sigilApi.createSigil({
        params: { projectId: project.id },
        body: { app: app.trim(), environment: environment.trim() },
      });
      setFreshToken(created.token);
      setApp("");
      setEnvironment("");
      toaster.success(tr("sigils.toast.created"));
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (sigil: SigilResource) => {
    if (!project) return;
    const confirmed = await dialog.confirm({
      title: tr("sigils.rotate.confirmTitle", { args: [sigil.label] }),
      description: tr("sigils.rotate.confirmDescription"),
      confirmLabel: tr("sigils.rotate.confirm"),
    });
    if (!confirmed) return;

    try {
      const rotated = await sigilApi.rotateSigil({
        params: { projectId: project.id, sigilId: sigil.id },
      });
      setFreshToken(rotated.token);
      toaster.success(tr("sigils.toast.rotated"));
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (sigil: SigilResource) => {
    if (!project) return;
    const confirmed = await dialog.confirm({
      title: tr("sigils.delete.confirmTitle", { args: [sigil.label] }),
      description: tr("sigils.delete.confirmDescription"),
      confirmLabel: tr("sigils.delete.confirm"),
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await sigilApi.deleteSigil({
        params: { projectId: project.id, sigilId: sigil.id },
      });
      toaster.success(tr("sigils.toast.deleted"));
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
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
            <ProjectSettingsTokenReveal
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
              value={app}
              aria-label={tr("sigils.create.app")}
              placeholder={tr("sigils.create.appPlaceholder")}
              onChange={(event) => setApp(event.target.value)}
            />
            <Input
              value={environment}
              aria-label={tr("sigils.create.environment")}
              placeholder={tr("sigils.create.environmentPlaceholder")}
              onChange={(event) => setEnvironment(event.target.value)}
            />
            <Button
              onClick={() => void create()}
              disabled={busy || !app.trim() || !environment.trim()}
            >
              <Plus />
              {tr("sigils.create.submit")}
            </Button>
          </div>

          <Card className="bg-card divide-y gap-0 rounded-lg border py-0">
            {sigils.length === 0 && (
              <CardContent className="px-4 py-6">
                <span className="text-muted-foreground text-sm">
                  {tr("sigils.empty")}
                </span>
              </CardContent>
            )}
            {sigils.map((sigil) => (
              <ProjectSettingsSigilRow
                key={sigil.id}
                sigil={sigil}
                onRotate={(target) => void rotate(target)}
                onDelete={(target) => void remove(target)}
              />
            ))}
          </Card>
        </div>
      )}
    </div>
  );
};

export default ProjectSettingsSigilsPage;
