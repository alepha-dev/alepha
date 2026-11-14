import { Badge, TimeAgo } from "@alepha/ui";
import { DataTable } from "@alepha/ui/table";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import {
  Ban,
  Check,
  CircleCheck,
  CircleX,
  Clock,
  History,
  LoaderCircle,
  Rocket,
  ScrollText,
  Undo2,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { DeployController } from "../../../../../api/controllers/DeployController.ts";
import { artifactHref } from "../artifacts/artifactView.ts";
import AppDeployLogDialog from "./AppDeployLogDialog.tsx";
import AppDeployRollbackDialog from "./AppDeployRollbackDialog.tsx";

export interface AppDeployRunsProps {
  projectId: number;
  instanceId: string;
  canWrite: boolean;
  /**
   * Opens "Deploy new artifact". Absent for a reader who cannot deploy, and
   * then the table offers no button.
   */
  onDeployNew?: () => void;
}

type Run = Record<string, any>;

/**
 * What has been deployed here, newest first, as the Deploy tab's whole page.
 *
 * ## ⚠️ It polls, and only while something is live
 *
 * The log is read from Lore's own `deployments` rows rather than proxied out of
 * a container's buffer: simpler, and it survives a Worker restart, which a
 * buffer does not. A run in flight is followed by re-asking; a list of finished
 * runs is asked for once.
 *
 * An auto-refreshing list is the shape of the QuestGraph incident (folio
 * #1057, 4,009 identical batch calls from one tab in 51 minutes), so the
 * interval is switched OFF the moment nothing is `queued` or `running`.
 *
 * ## Rollback is offered only where it can mean something
 *
 * A run is a rollback target when it succeeded, is not the run live now, did
 * not ship the same bytes as the live run, and nothing is deploying at the
 * moment. Anything else hides the action rather than offering a click the
 * server would refuse. What the rollback would take is the server's answer,
 * read when the dialog opens (`AppDeployRollbackDialog`).
 */
const AppDeployRuns = (props: AppDeployRunsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const deployApi = useClient<DeployController>();
  const [project] = useStore(currentProjectAtom);
  const [logOf, setLogOf] = useState<string>();
  const [rollbackTo, setRollbackTo] = useState<Run>();

  const { data, loading, error, refetch } = useQuery(
    {
      // Invalidated by the writes that add a run: a deploy started from
      // "Deploy new artifact", and a rollback (#E59, #Q2329).
      key: ["app-deployments", props.projectId, props.instanceId],
      // The list stays on screen while it is re-read after a write.
      keepPreviousData: true,
      handler: async () =>
        await deployApi.listDeployments({
          params: {
            projectId: props.projectId,
            instanceId: props.instanceId,
          },
        }),
      // Handled: the page renders its own error state below, so the root
      // `ActionErrorToaster` must not toast the same failure on top of it.
      onError: () => {},
    },
    [props.projectId, props.instanceId],
  );

  const items = (data?.items ?? []) as Run[];
  const live = items.some(
    (it) => it.status === "queued" || it.status === "running",
  );
  // Newest first, so the first success is what this copy runs now.
  const current = items.find((it) => it.status === "succeeded");

  /**
   * ⚠️ The poll, and it stops itself. An interval that outlives the run is the
   * shape of the QuestGraph incident; `live` goes false the moment nothing in
   * the list is moving, and the effect tears the timer down with it.
   */
  useEffect(() => {
    if (!live) {
      return;
    }
    const timer = setInterval(() => refetch(), 3_000);
    return () => clearInterval(timer);
  }, [live, refetch]);

  const canRollBackTo = (run: Run) =>
    props.canWrite &&
    !live &&
    run.status === "succeeded" &&
    !!current &&
    run.id !== current.id &&
    run.sha256 !== current.sha256;

  /**
   * ⚠️ **Spelled out rather than `tr(`app.deploy.status.${status}`)`.** An
   * interpolated key is invisible to `check:i18n`: it reports them as unused,
   * and a MISSING one as nothing at all.
   */
  const statusLabel = (run: Run) => {
    const status = String(run.status ?? "");
    if (status === "succeeded") {
      return run.id === current?.id
        ? tr("app.deploy.status.succeeded")
        : tr("app.deploy.status.superseded");
    }
    return status === "running"
      ? tr("app.deploy.status.running")
      : status === "failed"
        ? tr("app.deploy.status.failed")
        : status === "cancelled"
          ? tr("app.deploy.status.cancelled")
          : tr("app.deploy.status.queued");
  };

  if (loading && !data) {
    return (
      <p className="text-muted-foreground p-4 text-sm">
        {tr("app.deploy.loading")}
      </p>
    );
  }
  if (error && !data) {
    return (
      <p className="text-muted-foreground p-4 text-sm">
        {tr("app.deploy.error")}
      </p>
    );
  }

  return (
    <div
      data-testid="app-deploy-runs"
      className="flex min-h-0 flex-1 flex-col overflow-hidden p-2"
    >
      <DataTable<Run>
        className="min-h-0 flex-1"
        data={items}
        rowKey={(run) => String(run.id)}
        rowActionsDisplay="inline"
        hideColumnPicker
        emptyState={{
          icon: History,
          title: tr("app.deploy.empty"),
          action: undefined,
        }}
        actions={
          props.onDeployNew
            ? [
                {
                  icon: Rocket,
                  label: tr("app.deploy.new"),
                  primary: true,
                  onClick: props.onDeployNew,
                },
              ]
            : []
        }
        rowActions={(run) => [
          {
            label: tr("app.deploy.log.show"),
            icon: ScrollText,
            onClick: () => setLogOf(String(run.id)),
          },
          ...(canRollBackTo(run)
            ? [
                {
                  label: tr("app.deploy.rollback"),
                  icon: Undo2,
                  onClick: () => setRollbackTo(run),
                },
              ]
            : []),
        ]}
        columns={{
          status: {
            label: tr("app.deploy.table.status"),
            // The tinted tag the quests table uses for priority: a tone and
            // an icon, so the live run reads green at a glance and a failure
            // red, without reading the word.
            cell: (run) => {
              const status = String(run.status ?? "");
              const isCurrent = run.id === current?.id;
              const Icon =
                status === "failed"
                  ? CircleX
                  : status === "running"
                    ? LoaderCircle
                    : status === "queued"
                      ? Clock
                      : status === "cancelled"
                        ? Ban
                        : isCurrent
                          ? CircleCheck
                          : Check;
              const tone =
                status === "failed"
                  ? "danger"
                  : status === "running"
                    ? "info"
                    : status === "succeeded" && isCurrent
                      ? "success"
                      : "neutral";
              return (
                <Badge variant="tint" tone={tone}>
                  <Icon
                    className={
                      status === "running" ? "size-3 animate-spin" : "size-3"
                    }
                  />
                  {statusLabel(run)}
                </Badge>
              );
            },
          },
          tag: {
            label: tr("app.deploy.table.build"),
            cell: (run) => (
              <span className="flex min-w-0 items-baseline gap-2">
                <Link
                  href={artifactHref(project?.slug, {
                    app: String(run.app),
                    tag: String(run.tag),
                  })}
                  className="font-mono text-sm"
                >
                  {String(run.tag)}
                </Link>
                <span
                  className="text-muted-foreground font-mono text-xs"
                  title={String(run.sha256 ?? "")}
                >
                  {String(run.sha256 ?? "").slice(0, 12)}
                </span>
              </span>
            ),
          },
          createdAt: {
            label: tr("app.deploy.table.when"),
            cell: (run) => (
              <TimeAgo
                value={String(run.createdAt)}
                className="text-muted-foreground text-xs"
              />
            ),
          },
          error: {
            label: tr("app.deploy.table.error"),
            cell: (run) =>
              run.error ? (
                <span
                  className="text-danger-text block max-w-md truncate text-xs"
                  title={String(run.error)}
                >
                  {String(run.error)}
                </span>
              ) : null,
          },
        }}
      />

      <AppDeployLogDialog
        // Read from the list on every render, so an open log follows a run
        // that is still writing.
        run={logOf ? items.find((it) => String(it.id) === logOf) : undefined}
        onClose={() => setLogOf(undefined)}
      />
      <AppDeployRollbackDialog
        run={rollbackTo}
        current={current}
        projectId={props.projectId}
        onClose={() => setRollbackTo(undefined)}
      />
    </div>
  );
};

export default AppDeployRuns;
