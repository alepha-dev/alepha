import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { APP_NAME_MAX_LENGTH } from "@lore/core/schemas";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQuery, useStore } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { AppController } from "../../../../../api/controllers/AppController.ts";
import type { DeployController } from "../../../../../api/controllers/DeployController.ts";
import type { ProjectHostController } from "../../../../../api/controllers/ProjectHostController.ts";
import type { AppInstanceResource } from "../../../../../api/schemas/appInstanceResourceSchema.ts";
import type { ArtifactDetail } from "../../../../../api/schemas/artifactDetailSchema.ts";
import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { artifactManifestSummary } from "./artifactView.ts";

export interface ArtifactNewCopyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: ArtifactDetail;
  variant: ArtifactResource;
  /**
   * The copy exists. `deployed` says whether its first run was queued.
   */
  onCreated: (env: string, deployed: boolean) => void;
}

/**
 * A copy of this build's app, on a host that can run it.
 *
 * ## The app is not a field
 *
 * `DeployService.queue` finds a build by the copy's own `app`, so a copy under
 * any other name could never run the one it was created from.
 *
 * ## Ephemeral is here because it can be nowhere else
 *
 * `createApp` is its only way in: see that field's doc.
 *
 * ## ⚠️ Three calls, and D1 has no transaction
 *
 * Create, point at the host, deploy. A refused deploy leaves the copy
 * standing, which is the right half: the secrets it needs are set on that
 * copy, so the reader lands on it with the refusal rather than back here with
 * nothing to fix. A failure before that stays in the dialog, on values still
 * typed.
 */
const ArtifactNewCopyDialog = (props: ArtifactNewCopyDialogProps) => {
  const { detail, variant } = props;
  const { tr } = useI18n<I18n, "en">();
  const appApi = useClient<AppController>();
  const deployApi = useClient<DeployController>();
  const hostApi = useClient<ProjectHostController>();
  const [project] = useStore(currentProjectAtom);
  const [instances, setInstances] = useStore(currentInstancesAtom);

  const [error, setError] = useState<string>();
  const [ephemeral, setEphemeral] = useState(false);
  const [deployNow, setDeployNow] = useState(true);

  const { data } = useQuery(
    {
      enabled: Boolean(project) && props.open,
      key: ["project-hosts", project?.id],
      handler: async () => {
        if (!project) return undefined;
        return await hostApi.listProjectHosts({
          params: { projectId: project.id },
        });
      },
    },
    [project?.id, props.open],
  );

  const hosts = (data?.items ?? []).filter((host) =>
    host.acceptedRuntimes.some((runtime) => variant.runtimes.includes(runtime)),
  );

  const form = useForm({
    id: "artifact-new-copy",
    schema: z.object({
      env: z.string().min(1).max(APP_NAME_MAX_LENGTH),
      hostId: z.string().min(1),
    }),
    initialValues: { env: "", hostId: "" },
    handler: async (input) => {
      if (!project) return;
      const env = input.env.trim().toLowerCase();
      setError(undefined);

      let created: AppInstanceResource;
      try {
        created = await appApi.createApp({
          params: { projectId: project.id },
          body: { app: detail.app, env, ephemeral },
        });
        setInstances([...(instances ?? []), created]);
        await appApi.updateApp({
          params: { projectId: project.id, app: detail.app, env },
          body: { hostId: input.hostId },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }

      props.onOpenChange(false);
      if (!deployNow) {
        props.onCreated(env, false);
        return;
      }
      // ⚠️ `finally`, and no catch: a refusal rejects on to the root toaster,
      // and the reader still lands on the copy, where it can be fixed.
      try {
        await deployApi.startDeploy({
          params: { projectId: project.id, instanceId: created.id },
          body: { tag: detail.tag },
        });
      } finally {
        props.onCreated(env, true);
      }
    },
  });

  const { loading: submitting } = useFormState(form, ["loading"]);

  if (!project) {
    return null;
  }

  const secrets =
    variant.manifest && artifactManifestSummary(variant.manifest).secrets;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("artifact.newCopy.title", {
              args: [`${detail.app} ${detail.tag}`],
            })}
          </DialogTitle>
          <DialogDescription>
            {tr("artifact.newCopy.description", { args: [detail.app] })}
          </DialogDescription>
        </DialogHeader>

        <form
          data-testid="artifact-new-copy"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit();
          }}
        >
          <Control input={form.input.env} label={tr("apps.create.env")} />
          <Control
            select
            input={form.input.hostId}
            label={tr("artifact.newCopy.host")}
            description={
              hosts.length ? undefined : tr("artifact.newCopy.noHost")
            }
            items={hosts.map((host) => ({
              value: host.id,
              label: host.label ? `${host.slug} (${host.label})` : host.slug,
            }))}
          />

          <Label className="flex items-start gap-2 font-normal">
            <Checkbox
              checked={ephemeral}
              onCheckedChange={(value) => setEphemeral(value === true)}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm">
                {tr("artifact.newCopy.ephemeral")}
              </span>
              <span className="text-muted-foreground text-xs">
                {tr("artifact.newCopy.ephemeralHint")}
              </span>
            </span>
          </Label>

          <Label className="flex items-start gap-2 font-normal">
            <Checkbox
              checked={deployNow}
              onCheckedChange={(value) => setDeployNow(value === true)}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm">
                {tr("artifact.newCopy.deployNow", { args: [detail.tag] })}
              </span>
              {secrets && secrets.length > 0 && (
                <span className="text-muted-foreground text-xs">
                  {tr("artifact.newCopy.secrets", {
                    args: [String(secrets.length)],
                  })}
                </span>
              )}
            </span>
          </Label>

          {error && <p className="text-danger-text text-sm">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outlined"
              onClick={() => props.onOpenChange(false)}
            >
              {tr("common.cancel")}
            </Button>
            <Button type="submit" disabled={submitting || !hosts.length}>
              {tr("artifact.newCopy.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ArtifactNewCopyDialog;
