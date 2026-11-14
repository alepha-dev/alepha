import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { DeployController } from "../../../../../api/controllers/DeployController.ts";
import type { AppInstanceResource } from "../../../../../api/schemas/appInstanceResourceSchema.ts";
import type { ArtifactGroup } from "../../../../../api/schemas/artifactGroupSchema.ts";
import AppArtifactsList from "./AppArtifactsList.tsx";

export interface AppDeployPickDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  instance: AppInstanceResource;
  /**
   * The runtimes this copy's host runs, from `acceptedRuntimes`, the module
   * the server's gate reads too.
   */
  runnable: string[];
}

/**
 * "Deploy new artifact": the app's builds, each with a Deploy button.
 *
 * ## The build list is `AppArtifactsList`, not a second one
 *
 * `AppArtifactsList` with an `action` slot, so the Deploy tab and the
 * project's artifact pages cannot disagree about column widths or about which
 * digest is short enough.
 *
 * ## ⚠️ The runtime refusal happens HERE, before the call
 *
 * `artifacts` is unique on `(projectId, app, tag, runtime, format)` and an
 * host accepts one runtime and no image at all, so a tag with no ARCHIVE
 * variant this host can run is a deploy that fails at the gate. The button
 * is disabled with the reason on it rather than enabled into a refusal - the
 * server still refuses (#1598, and `DeployService.queue` for the format half),
 * and this is the affordance, not the boundary.
 *
 * ## ⚠️ There is no host picker, and there must not be one
 *
 * The host is a property of the copy, chosen on its Settings tab and
 * resolved server-side (#1205). Only a tag goes on the wire.
 */
const AppDeployPickDialog = (props: AppDeployPickDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const deployApi = useClient<DeployController>();
  // Which tag the label names while the deploy starts. Every deploy button is
  // disabled for that time (busy is dialog-wide); only the clicked one says so.
  const [picked, setPicked] = useState("");

  // The refusal is the server's own words, shown by the root
  // `ActionErrorToaster` (#E59, #Q2329).
  const deployAction = useAction<[group: ArtifactGroup], void>(
    {
      handler: async (_ctx, group) => {
        await deployApi.startDeploy({
          params: {
            projectId: props.projectId,
            instanceId: props.instance.id,
          },
          // ⚠️ A tag and nothing else. No host on the wire, ever.
          body: { tag: group.tag },
        });
        toaster.success(tr("app.deploy.started", { args: [group.tag] }));
        props.onOpenChange(false);
      },
      // The history picks the new run up.
      invalidates: [["app-deployments", props.projectId, props.instance.id]],
    },
    [deployApi, props.projectId, props.instance.id, toaster, tr],
  );

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!deployAction.loading) props.onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-4xl" data-testid="app-deploy-pick">
        <DialogHeader>
          <DialogTitle>{tr("app.deploy.pick")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto">
          <AppArtifactsList
            app={props.instance.app}
            action={(group) => {
              // ⚠️ `format === "archive"` is half of this test, not
              // decoration. An image row carries a REAL runtime - Lore's own
              // image is `node` - so a tag whose only node variant is an
              // image would light this button up and the server would refuse
              // the click. And every slice, not the primary (#Q2462): a
              // `node,workerd` archive is deployable to a Cloudflare host.
              const usable = group.variants.some(
                (variant) =>
                  variant.format === "archive" &&
                  variant.runtimes.some((runtime) =>
                    props.runnable.includes(runtime),
                  ),
              );
              const imageOnly =
                !usable && group.variants.every((it) => it.format === "image");
              return (
                <Button
                  size="sm"
                  variant={usable ? "solid" : "outlined"}
                  disabled={!usable || deployAction.loading}
                  title={
                    usable
                      ? undefined
                      : imageOnly
                        ? tr("app.deploy.imageOnly")
                        : tr("app.deploy.wrongRuntime", {
                            args: [props.runnable[0]],
                          })
                  }
                  onClick={() => {
                    setPicked(group.tag);
                    void deployAction.run(group);
                  }}
                  data-testid={`app-deploy-${group.tag}`}
                >
                  {deployAction.loading && picked === group.tag
                    ? tr("app.deploy.starting")
                    : tr("app.deploy.action")}
                </Button>
              );
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AppDeployPickDialog;
