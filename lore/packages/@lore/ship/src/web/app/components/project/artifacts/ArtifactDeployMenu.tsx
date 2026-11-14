import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useToast,
} from "@alepha/ui";
import {
  capabilityOption,
  currentProjectAtom,
  type I18n,
} from "@lore/core/web";
import { useAction, useClient, useQueryClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { ChevronDown, Rocket } from "lucide-react";
import { useState } from "react";

import type { AppController } from "../../../../../api/controllers/AppController.ts";
import type { DeployController } from "../../../../../api/controllers/DeployController.ts";
import { acceptedRuntimes } from "../../../../../api/schemas/acceptedRuntimes.ts";
import type { ArtifactDetail } from "../../../../../api/schemas/artifactDetailSchema.ts";
import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";
import ArtifactNewCopyDialog from "./ArtifactNewCopyDialog.tsx";
import type { ArtifactCopy } from "./artifactView.ts";

export interface ArtifactDeployMenuProps {
  detail: ArtifactDetail;
  variant: ArtifactResource;
}

/**
 * Ship this build: to a copy that can run it, or to a new one.
 *
 * Absent for an image, which only ever has a reference to pull, and without
 * the `apps.deploy` option. A copy with no host, or a host that cannot
 * run this build, is left out here: the server would refuse it, and offering
 * a refusal is the experience `acceptedRuntimes` exists to prevent.
 */
const ArtifactDeployMenu = (props: ArtifactDeployMenuProps) => {
  const { detail, variant } = props;
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const router = useRouter();
  const queries = useQueryClient();
  const deployApi = useClient<DeployController>();
  const appApi = useClient<AppController>();
  const [project] = useStore(currentProjectAtom);
  const [creating, setCreating] = useState(false);

  const deploy = useAction<[copy: ArtifactCopy], void>(
    {
      handler: async (_context, copy) => {
        if (!project) return;
        await deployApi.startDeploy({
          params: { projectId: project.id, instanceId: copy.id },
          body: { tag: detail.tag },
        });
        toaster.success(tr("app.deploy.started", { args: [detail.tag] }));
        queries.invalidate([
          "project-artifact",
          project.id,
          detail.app,
          detail.tag,
        ]);
      },
    },
    [deployApi, project?.id, detail.app, detail.tag, toaster, tr, queries],
  );

  if (
    !project ||
    variant.format !== "archive" ||
    !capabilityOption(project, "apps", "deploy") ||
    !deployApi.startDeploy.can()
  ) {
    return null;
  }

  const targets = detail.copies.filter(
    (copy) =>
      copy.host &&
      acceptedRuntimes(copy.host.type).some((runtime) =>
        variant.runtimes.includes(runtime),
      ),
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button data-testid="artifact-deploy" />}
          disabled={deploy.loading}
        >
          <Rocket className="size-4" aria-hidden />
          {tr("artifact.deploy.action")}
          <ChevronDown className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {targets.map((copy) => (
            <DropdownMenuItem key={copy.id} onClick={() => deploy.run(copy)}>
              {copy.env}
            </DropdownMenuItem>
          ))}
          {targets.length > 0 && appApi.createApp.can() && (
            <DropdownMenuSeparator />
          )}
          {appApi.createApp.can() && (
            <DropdownMenuItem onClick={() => setCreating(true)}>
              {tr("artifact.deploy.newCopy")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ArtifactNewCopyDialog
        open={creating}
        onOpenChange={setCreating}
        detail={detail}
        variant={variant}
        onCreated={(env, deployed) =>
          void router.push(deployed ? "appDeploy" : "app", {
            params: { projectSlug: project.slug, app: detail.app, env },
          })
        }
      />
    </>
  );
};

export default ArtifactDeployMenu;
