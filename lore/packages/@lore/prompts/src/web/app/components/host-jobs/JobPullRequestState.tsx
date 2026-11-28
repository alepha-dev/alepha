import { Badge } from "@alepha/ui";
import type { PullRequestState } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

export interface JobPullRequestStateProps {
  pullRequests: PullRequestState[];
}

/**
 * A job's pull request in one line, for a job row (#Q4369): its number, its
 * state and a dot for its checks. The page shows the rest.
 */
const JobPullRequestState = (props: JobPullRequestStateProps) => {
  const { tr } = useI18n<I18n, "en">();
  const pr = props.pullRequests[0];
  if (!pr) return null;
  const label =
    pr.state === "merged"
      ? tr("pullRequest.state.merged")
      : pr.state === "closed"
        ? tr("pullRequest.state.closed")
        : pr.state === "draft"
          ? tr("pullRequest.state.draft")
          : tr("pullRequest.state.open");
  return (
    <span
      className="inline-flex items-center gap-1 text-xs"
      data-testid="job-row-pull-request"
    >
      <span className="text-muted-foreground">#{pr.number}</span>
      <Badge
        variant="tint"
        tone={
          pr.state === "merged"
            ? "violet"
            : pr.state === "closed"
              ? "red"
              : pr.state === "draft"
                ? "neutral"
                : "green"
        }
      >
        {label}
      </Badge>
      {pr.checks !== "none" &&
        pr.state !== "merged" &&
        pr.state !== "closed" && (
          <span
            aria-label={
              pr.checks === "failing"
                ? tr("pullRequest.checks.failing")
                : pr.checks === "passing"
                  ? tr("pullRequest.checks.passing")
                  : tr("pullRequest.checks.pending")
            }
            className={`inline-block size-2 rounded-full ${
              pr.checks === "failing"
                ? "bg-danger"
                : pr.checks === "passing"
                  ? "bg-success"
                  : "bg-warning"
            }`}
          />
        )}
    </span>
  );
};

export default JobPullRequestState;
