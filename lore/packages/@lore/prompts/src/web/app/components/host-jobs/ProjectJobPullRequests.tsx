import { Badge, cn, textLinkUnderlineClassName } from "@alepha/ui";
import type { HostJobController } from "@lore/core/api";
import type { HostJobResource, PullRequestState } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ExternalLink } from "lucide-react";
import { useState } from "react";

export interface ProjectJobPullRequestsProps {
  job: HostJobResource;
}

/**
 * The job's pull requests on its page (#Q4369): number, title, branch and a
 * link to GitHub; state, the failing checks by name with their runs, the
 * review, and whether it is behind its base or in conflict when GitHub said
 * so. Read from Lore's rows, never from GitHub.
 *
 * A pull request moves mostly after its job ended (checks, review, merge),
 * so this keeps its own light poll: every 30 s while one shown is open or a
 * draft, paused on a hidden tab, stopped once each is merged or closed.
 */
const ProjectJobPullRequests = (props: ProjectJobPullRequestsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<HostJobController>();
  const [live, setLive] = useState(
    (props.job.pullRequests ?? []).some(ProjectJobPullRequests.open),
  );
  const read = useQuery(
    {
      key: ["job-pull-requests", props.job.id],
      handler: async () => {
        const job = await api.getJob({ params: { jobId: props.job.id } });
        const items = job.pullRequests ?? [];
        setLive(items.some(ProjectJobPullRequests.open));
        return items;
      },
      enabled: live,
      runEvery: live ? 30_000 : undefined,
      onError: () => {},
    },
    // `runEvery` is read on each render, so `live` stays out of the deps.
    [api, props.job.id],
  );
  const items = read.data ?? props.job.pullRequests ?? [];
  if (items.length === 0) return null;
  const shared = /^lore\/q\d+$/.test(props.job.input.source?.branch ?? "");

  return (
    <span
      className="flex min-w-0 flex-col items-end gap-2 text-right"
      data-testid="job-pull-requests"
    >
      {items.map((pr) => (
        <span key={pr.number} className="flex min-w-0 flex-col items-end gap-1">
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              textLinkUnderlineClassName,
              "inline-flex max-w-full items-center gap-1 truncate",
            )}
          >
            #{pr.number} {pr.title}
            <ExternalLink className="size-3 shrink-0" />
          </a>
          <span className="text-muted-foreground max-w-full truncate text-xs">
            {pr.headRef} → {pr.baseRef}
          </span>
          <span className="flex flex-wrap justify-end gap-1">
            <Badge
              variant="tint"
              tone={ProjectJobPullRequests.tone(pr)}
              data-testid="job-pull-request-state"
            >
              {pr.state === "merged"
                ? tr("pullRequest.state.merged")
                : pr.state === "closed"
                  ? tr("pullRequest.state.closed")
                  : pr.state === "draft"
                    ? tr("pullRequest.state.draft")
                    : pr.queued
                      ? tr("pullRequest.state.queued")
                      : tr("pullRequest.state.open")}
            </Badge>
            {pr.checks !== "none" && (
              <Badge
                variant="tint"
                tone={
                  pr.checks === "failing"
                    ? "danger"
                    : pr.checks === "passing"
                      ? "success"
                      : "warning"
                }
              >
                {pr.checks === "failing"
                  ? tr("pullRequest.checks.failing")
                  : pr.checks === "passing"
                    ? tr("pullRequest.checks.passing")
                    : tr("pullRequest.checks.pending")}
              </Badge>
            )}
            {pr.review !== "none" && (
              <Badge variant="tint" tone="neutral">
                {pr.review === "approved"
                  ? tr("pullRequest.review.approved")
                  : pr.review === "changes_requested"
                    ? tr("pullRequest.review.changes")
                    : tr("pullRequest.review.requested")}
              </Badge>
            )}
            {pr.state === "open" && pr.mergeableState === "behind" && (
              <Badge variant="tint" tone="warning">
                {tr("pullRequest.behind")}
              </Badge>
            )}
            {pr.state === "open" && pr.mergeableState === "dirty" && (
              <Badge variant="tint" tone="danger">
                {tr("pullRequest.conflict")}
              </Badge>
            )}
          </span>
          {pr.checks === "failing" && (pr.failingChecks ?? []).length > 0 && (
            <span
              className="flex flex-col items-end gap-0.5 text-xs"
              data-testid="job-pull-request-failing"
            >
              {(pr.failingChecks ?? []).map((check) =>
                check.url ? (
                  <a
                    key={check.id}
                    href={check.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      textLinkUnderlineClassName,
                      "text-danger-text",
                    )}
                  >
                    {check.name}
                  </a>
                ) : (
                  <span key={check.id} className="text-danger-text">
                    {check.name}
                  </span>
                ),
              )}
            </span>
          )}
        </span>
      ))}
      {shared && (
        <span className="text-muted-foreground text-xs">
          {tr("pullRequest.sharedByQuest")}
        </span>
      )}
    </span>
  );
};

ProjectJobPullRequests.open = (pr: PullRequestState): boolean =>
  pr.state === "open" || pr.state === "draft";

ProjectJobPullRequests.tone = (
  pr: PullRequestState,
): "violet" | "red" | "neutral" | "green" =>
  pr.state === "merged"
    ? "violet"
    : pr.state === "closed"
      ? "red"
      : pr.state === "draft"
        ? "neutral"
        : "green";

export default ProjectJobPullRequests;
