import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { DeployController } from "@/api/controllers/DeployController.ts";

import type { I18n } from "../../../services/I18n.ts";
import AppDeployRun from "./AppDeployRun.tsx";

export interface AppDeployRunsProps {
  projectId: number;
  instanceId: string;
  canWrite: boolean;
  /**
   * Bumped by the parent after a deploy starts, so the list picks the new run
   * up without the parent knowing how this component fetches.
   */
  reloadToken: number;
  onChanged: () => void;
}

/**
 * What has been deployed here, newest first.
 *
 * ## ⚠️ It polls, and only while something is live
 *
 * The log is read from Lore's own `deployments` rows rather than proxied out of
 * a container's buffer: simpler, and it survives a Worker restart, which a
 * buffer does not. A run in flight is followed by re-asking; a list of finished
 * runs is asked for once.
 *
 * Ten auto-refreshing tiles is the shape of the QuestGraph incident (folio
 * #1057, 4,009 identical batch calls from one tab in 51 minutes), so the
 * interval is switched OFF the moment nothing is `queued` or `running`.
 */
const AppDeployRuns = (props: AppDeployRunsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const deployApi = useClient<DeployController>();

  const { data, loading, error, refetch } = useQuery(
    {
      key: [
        "app-deployments",
        props.projectId,
        props.instanceId,
        props.reloadToken,
      ],
      handler: async () =>
        await deployApi.listDeployments({
          params: {
            projectId: props.projectId,
            instanceId: props.instanceId,
          },
        }),
    },
    [props.projectId, props.instanceId, props.reloadToken],
  );

  const items = (data?.items ?? []) as Array<Record<string, any>>;
  const live = items.some(
    (it) => it.status === "queued" || it.status === "running",
  );

  return (
    <Card data-testid="app-deploy-runs">
      <CardHeader>
        <CardTitle className="text-base">{tr("app.deploy.runs")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {loading && !data ? (
          <p className="text-muted-foreground text-sm">
            {tr("app.deploy.loading")}
          </p>
        ) : error ? (
          <p className="text-muted-foreground text-sm">
            {tr("app.deploy.error")}
          </p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {tr("app.deploy.empty")}
          </p>
        ) : (
          <div className="flex flex-col divide-y">
            {items.map((run) => (
              <AppDeployRun
                key={String(run.id)}
                run={run}
                projectId={props.projectId}
                canWrite={props.canWrite}
                live={live}
                onFollow={refetch}
                onChanged={props.onChanged}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AppDeployRuns;
