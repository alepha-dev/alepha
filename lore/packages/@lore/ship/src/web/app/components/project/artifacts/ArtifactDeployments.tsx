import { Badge, TimeAgo } from "@alepha/ui";
import { DataTable } from "@alepha/ui/table";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import type { ArtifactDetail } from "../../../../../api/schemas/artifactDetailSchema.ts";

export interface ArtifactDeploymentsProps {
  detail: ArtifactDetail;
}

type ArtifactRun = ArtifactDetail["deployments"][number];

/**
 * The runs that shipped this tag, newest first, as a flat table filling the
 * tab edge to edge (#Q3669), like the Hosts and Quests tables. A row opens
 * the Deploy tab of its copy, which holds the log.
 *
 * Commit is the commit CI built the deployed variant from, matched by its
 * digest (a run of one tag deploys one of its variants), else the tag's. A
 * push that named none, or a digest no variant holds any more, shows the
 * digest's head instead.
 *
 * ⚠️ The status label of `app.deploy.status.*` is named run by run rather than
 * built from the value: `check:i18n` reads call sites.
 */
const ArtifactDeployments = (props: ArtifactDeploymentsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);

  if (!project) {
    return null;
  }

  const labels = {
    queued: tr("app.deploy.status.queued"),
    running: tr("app.deploy.status.running"),
    succeeded: tr("app.deploy.status.succeeded"),
    failed: tr("app.deploy.status.failed"),
    cancelled: tr("app.deploy.status.cancelled"),
  };

  const commits = new Map(
    props.detail.variants.map((variant) => [
      variant.sha256,
      variant.commitSha ?? props.detail.commitSha,
    ]),
  );

  return (
    <div
      data-testid="artifact-deployments"
      className="flex h-full min-h-0 flex-col"
    >
      <DataTable<ArtifactRun>
        className="min-h-0 flex-1"
        flat
        data={props.detail.deployments}
        rowKey={(run) => run.id}
        defaultSize={50}
        defaultSort={{ field: "createdAt", direction: "desc" }}
        emptyMessage={tr("artifact.deployments.empty")}
        onRowClick={(run) => {
          if (!run.env) return;
          void router.push("appDeploy", {
            params: {
              projectSlug: project.slug,
              app: props.detail.app,
              env: run.env,
            },
          });
        }}
        columns={{
          env: {
            label: tr("artifact.deployments.column.copy"),
            sortable: true,
            sortValue: (run) => run.env ?? "",
            cell: (run) => (
              <span className="font-medium">
                {run.env
                  ? `${props.detail.app} / ${run.env}`
                  : props.detail.app}
              </span>
            ),
          },
          status: {
            label: tr("artifact.deployments.column.status"),
            sortable: true,
            cell: (run) => (
              <span className="flex min-w-0 items-center gap-2">
                <Badge
                  variant={run.status === "failed" ? "destructive" : "tint"}
                >
                  {labels[run.status]}
                </Badge>
                {run.error && (
                  <span
                    className="text-danger-text min-w-0 truncate text-xs"
                    title={run.error}
                  >
                    {run.error}
                  </span>
                )}
              </span>
            ),
          },
          commit: {
            label: tr("artifact.deployments.column.commit"),
            cell: (run) => {
              const commit = commits.get(run.sha256);
              return (
                <code
                  className="text-muted-foreground font-mono text-xs"
                  title={commit ?? run.sha256}
                >
                  {commit ? commit.slice(0, 7) : run.sha256.slice(0, 12)}
                </code>
              );
            },
          },
          createdAt: {
            label: tr("artifact.deployments.column.when"),
            sortable: true,
            cell: (run) => (
              <TimeAgo
                value={run.createdAt}
                className="text-muted-foreground text-xs"
              />
            ),
          },
          author: {
            label: tr("artifact.deployments.column.author"),
            sortable: true,
            sortValue: (run) => run.author ?? "",
            cell: (run) => (
              <span className="text-muted-foreground text-xs">
                {run.author ?? "-"}
              </span>
            ),
          },
        }}
      />
    </div>
  );
};

export default ArtifactDeployments;
