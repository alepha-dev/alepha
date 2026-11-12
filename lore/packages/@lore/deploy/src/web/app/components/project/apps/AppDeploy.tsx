import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui";
import { currentProjectAtom, type I18n, useRank } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";

import { acceptedRuntimes } from "../../../../../api/schemas/acceptedRuntimes.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import AppDeployPickDialog from "./AppDeployPickDialog.tsx";
import AppDeployRuns from "./AppDeployRuns.tsx";

/**
 * The Deploy tab: the history of what has run here, full height, with
 * "Deploy new artifact" over it.
 *
 * ## ⚠️ There is no estate picker, and there must not be one
 *
 * The estate is a property of the copy, chosen once on its Settings tab and
 * resolved server-side at deploy time (#1205). A picker here would be a second
 * place to choose it, and the one thing epics #22 and #30 both insist on is
 * that the client never names an estate. So the empty state is "this copy has
 * no estate yet", pointing at that Settings row - not at a connect flow.
 *
 * Owns no padding: the history is a `DataTable` that fills the plate, which
 * is why `AppLayout` gives this tab no scroll region of its own.
 */
const AppDeploy = () => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const router = useRouter();
  const [picking, setPicking] = useState(false);

  const [project] = useStore(currentProjectAtom);
  const [instance] = useStore(currentInstanceAtom);

  if (!project || !instance) {
    return null;
  }

  // A stack member deploys through its stack environment, which holds the
  // estate (#Q2695).
  if (!instance.estateId && !instance.stackEnvironmentId) {
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
              variant="outlined"
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

  return (
    <>
      <AppDeployRuns
        projectId={project.id}
        instanceId={instance.id}
        canWrite={canDeploy}
        onDeployNew={canDeploy ? () => setPicking(true) : undefined}
      />
      {canDeploy ? (
        <AppDeployPickDialog
          open={picking}
          onOpenChange={setPicking}
          projectId={project.id}
          instance={instance}
          // Derived from the estate's TYPE through the module the server reads
          // too, so the button and the gate cannot disagree about what this
          // copy can run.
          runnable={acceptedRuntimes(
            instance.estate?.type ?? (instance.stack ? "bay" : "cloudflare"),
          )}
        />
      ) : null}
    </>
  );
};

export default AppDeploy;
