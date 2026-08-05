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
  OutpostController,
  OutpostResource,
} from "@/api/controllers/OutpostController.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import ProjectSettingsFeatureSection from "./ProjectSettingsFeatureSection.tsx";
import ProjectSettingsOutpostRow from "./ProjectSettingsOutpostRow.tsx";
import ProjectSettingsTokenReveal from "./ProjectSettingsTokenReveal.tsx";
import { useProjectFeatureToggle } from "./useProjectFeatureToggle.ts";

/**
 * Which machines report into this project.
 *
 * An outpost is **one machine**, not one application — that is what separates
 * it from a sigil. So the form asks only for a label: two machines with the
 * same name are a naming annoyance, never a data problem, because the identity
 * is the credential.
 *
 * The token appears exactly once, at creation. It is stored hashed, so nothing
 * can show it again. The way back from a lost or leaked token is to rotate it,
 * which is offered beside delete precisely because delete is not the same
 * thing: hosted applications and deploy events cascade, so deleting a machine
 * to revoke a token also erases everything it ever reported.
 */
const ProjectSettingsOutpostsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const outpostApi = useClient<OutpostController>();
  const [project] = useStore(currentProjectAtom);

  const master = useProjectFeatureToggle("outposts");

  const [outposts, setOutposts] = useState<OutpostResource[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  /** The one moment a token is readable. Cleared as soon as it is dismissed. */
  const [freshToken, setFreshToken] = useState<string | undefined>();

  const enabled = master.enabled;

  const reload = useCallback(async () => {
    if (!project) return;
    try {
      // `listOutposts` responds with the array itself, not `{ items }` —
      // unlike `listSigils`. Reading `.items` here silently renders nothing.
      const res = await outpostApi.listOutposts({
        params: { projectId: project.id },
      });
      setOutposts(res);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  }, [project, outpostApi]);

  useEffect(() => {
    if (project && enabled) {
      void reload();
    }
  }, [project, enabled, reload]);

  const create = async () => {
    if (!project || !label.trim()) return;
    setBusy(true);
    try {
      const created = await outpostApi.createOutpost({
        params: { projectId: project.id },
        body: { label: label.trim() },
      });
      setFreshToken(created.token);
      setLabel("");
      toaster.success(tr("outposts.toast.created"));
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (outpost: OutpostResource) => {
    if (!project) return;
    const confirmed = await dialog.confirm({
      title: tr("outposts.rotate.confirmTitle", { args: [outpost.label] }),
      description: tr("outposts.rotate.confirmDescription"),
      confirmLabel: tr("outposts.rotate.confirm"),
    });
    if (!confirmed) return;

    try {
      const rotated = await outpostApi.rotateOutpost({
        params: { projectId: project.id, outpostId: outpost.id },
      });
      setFreshToken(rotated.token);
      toaster.success(tr("outposts.toast.rotated"));
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (outpost: OutpostResource) => {
    if (!project) return;
    const confirmed = await dialog.confirm({
      title: tr("outposts.delete.confirmTitle", { args: [outpost.label] }),
      description: tr("outposts.delete.confirmDescription"),
      confirmLabel: tr("outposts.delete.confirm"),
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await outpostApi.deleteOutpost({
        params: { projectId: project.id, outpostId: outpost.id },
      });
      toaster.success(tr("outposts.toast.deleted"));
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  if (!project) return null;

  return (
    <div className="flex flex-col gap-6">
      <ProjectSettingsFeatureSection
        featureKey="outposts"
        enabled={enabled}
        onToggle={master.toggle}
      />

      {enabled && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{tr("outposts.title")}</span>
            <span className="text-muted-foreground text-xs">
              {tr("outposts.subtitle")}
            </span>
          </div>

          {freshToken && (
            <ProjectSettingsTokenReveal
              token={freshToken}
              title={tr("outposts.token.title")}
              copyLabel={tr("outposts.token.copy")}
              doneLabel={tr("outposts.token.done")}
              copiedMessage={tr("outposts.toast.copied")}
              onDismiss={() => setFreshToken(undefined)}
            />
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={label}
              aria-label={tr("outposts.create.label")}
              placeholder={tr("outposts.create.labelPlaceholder")}
              onChange={(event) => setLabel(event.target.value)}
            />
            <Button
              onClick={() => void create()}
              disabled={busy || !label.trim()}
            >
              <Plus />
              {tr("outposts.create.submit")}
            </Button>
          </div>

          <Card className="bg-card divide-y gap-0 rounded-lg border py-0">
            {outposts.length === 0 && (
              <CardContent className="px-4 py-6">
                <span className="text-muted-foreground text-sm">
                  {tr("outposts.empty")}
                </span>
              </CardContent>
            )}
            {outposts.map((outpost) => (
              <ProjectSettingsOutpostRow
                key={outpost.id}
                outpost={outpost}
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

export default ProjectSettingsOutpostsPage;
