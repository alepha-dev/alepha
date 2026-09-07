import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";

import type { DeployController } from "@/api/controllers/DeployController.ts";
import { acceptedRuntimes } from "@/api/schemas/acceptedRuntimes.ts";
import type { ArtifactGroup } from "@/api/schemas/artifactGroupSchema.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { useRank } from "../../shared/useRank.ts";
import AppArtifactsList from "./AppArtifactsList.tsx";
import AppDeployRuns from "./AppDeployRuns.tsx";

/**
 * The Deploy tab: what has run here, and what to ship next.
 *
 * ## ⚠️ There is no estate picker, and there must not be one
 *
 * The estate is a property of the copy, chosen once on its Settings tab and
 * resolved server-side at deploy time (#1205). A picker here would be a second
 * place to choose it, and the one thing epics #22 and #30 both insist on is
 * that the client never names an estate. So the empty state is "this copy has
 * no estate yet", pointing at that Settings row - not at a connect flow.
 *
 * ## The build list is the Artifacts tab's, not a second one
 *
 * `AppArtifactsList` with an `action` slot. Two artifact tables on one instance
 * page, disagreeing about column widths and about which digest is short enough,
 * is the outcome the reuse exists to prevent.
 *
 * ## ⚠️ The runtime refusal happens HERE, before the call
 *
 * `artifacts` is unique on `(projectId, app, tag, runtime)` and an estate
 * accepts one runtime, so a tag with no variant this estate can run is a deploy
 * that fails at the gate. The button is disabled with the reason on it rather
 * than enabled into a refusal - the server still refuses (#1598), and this is
 * the affordance, not the boundary.
 */
const AppDeploy = () => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const toaster = useToast();
  const router = useRouter<AppRouter>();
  const deployApi = useClient<DeployController>();

  const [project] = useStore(currentProjectAtom);
  const [instance] = useStore(currentInstanceAtom);
  const [busy, setBusy] = useState("");
  const [reload, setReload] = useState(0);

  if (!project || !instance) {
    return null;
  }

  if (!instance.estateId) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Card data-testid="app-deploy-no-estate">
          <CardHeader>
            <CardTitle className="text-base">{tr("app.deploy")}</CardTitle>
            <CardDescription>
              {tr("app.deploy.noEstate.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() =>
                router.push("appSettings", {
                  params: {
                    projectSlug: project.slug,
                    app: instance.app,
                    env: instance.env,
                  },
                })
              }
            >
              {tr("app.deploy.noEstate.action")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Rank, not ownership: `deploy:manage` is its own permission and an owner
  // may have granted it to a rank. ⚠️ Never the boundary - the endpoints refuse
  // server-side, and a hidden button refuses nothing.
  const canDeploy = can("deploy:manage");
  // Derived from the estate's TYPE through the module the server reads too, so
  // the button and the gate cannot disagree about what this copy can run.
  const runnable = acceptedRuntimes(instance.estate?.type ?? "cloudflare");

  const deploy = async (group: ArtifactGroup) => {
    setBusy(group.tag);
    try {
      await deployApi.startDeploy({
        params: { projectId: project.id, instanceId: instance.id },
        // ⚠️ A tag and nothing else. No estate on the wire, ever.
        body: { tag: group.tag },
      });
      toaster.success(tr("app.deploy.started", { args: [group.tag] }));
      setReload((it) => it + 1);
    } catch (error) {
      // The server's own words: the runtime gate and the credential clauses
      // are written for somebody who often cannot fix them from here.
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <AppDeployRuns
        projectId={project.id}
        instanceId={instance.id}
        canWrite={canDeploy}
        reloadToken={reload}
        onChanged={() => setReload((it) => it + 1)}
      />

      <AppArtifactsList
        app={instance.app}
        title={tr("app.deploy.pick")}
        action={(group) => {
          const usable = group.variants.some((variant) =>
            runnable.includes(variant.runtime),
          );
          if (!canDeploy) {
            return null;
          }
          return (
            <Button
              size="sm"
              variant={usable ? "default" : "outline"}
              disabled={!usable || busy !== ""}
              title={
                usable
                  ? undefined
                  : tr("app.deploy.wrongRuntime", { args: [runnable[0]] })
              }
              onClick={() => deploy(group)}
              data-testid={`app-deploy-${group.tag}`}
            >
              {busy === group.tag
                ? tr("app.deploy.starting")
                : tr("app.deploy.action")}
            </Button>
          );
        }}
      />
    </div>
  );
};

export default AppDeploy;
