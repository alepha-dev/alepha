import { Badge, TimeAgo } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { ArtifactDetail } from "../../../../../api/schemas/artifactDetailSchema.ts";

export interface ArtifactDeploymentsProps {
  detail: ArtifactDetail;
}

/**
 * The runs that shipped this tag, newest first, each linking to the Deploy tab
 * of its copy, which holds the log.
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

  return (
    <div
      data-testid="artifact-deployments"
      className="flex flex-col divide-y p-4 text-sm"
    >
      {props.detail.deployments.length === 0 && (
        <p className="text-muted-foreground">
          {tr("artifact.deployments.empty")}
        </p>
      )}
      {props.detail.deployments.map((run) => (
        <div
          key={run.id}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2"
        >
          {run.env ? (
            <Link
              href={router.path("appDeploy", {
                params: {
                  projectSlug: project.slug,
                  app: props.detail.app,
                  env: run.env,
                },
              })}
              className="font-medium"
            >
              {props.detail.app} / {run.env}
            </Link>
          ) : (
            <span className="font-medium">{props.detail.app}</span>
          )}
          <Badge variant={run.status === "failed" ? "destructive" : "tint"}>
            {labels[run.status]}
          </Badge>
          <code
            className="text-muted-foreground font-mono text-xs"
            title={run.sha256}
          >
            {run.sha256.slice(0, 12)}
          </code>
          {run.error && (
            <span className="text-danger-text min-w-0 truncate text-xs">
              {run.error}
            </span>
          )}
          <TimeAgo
            value={run.createdAt}
            className="text-muted-foreground ml-auto text-xs"
          />
        </div>
      ))}
    </div>
  );
};

export default ArtifactDeployments;
