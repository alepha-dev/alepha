import { Badge, Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui";
import type { PullRequestState } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

export interface PullRequestStateChipProps {
  state: PullRequestState;
}

/**
 * A pull request's GitHub state beside its number (#Q4367): draft, open, in
 * the merge queue, merged or closed, and its checks when it has any. Read
 * from Lore's row, kept from GitHub's deliveries.
 */
const PullRequestStateChip = (props: PullRequestStateChipProps) => {
  const { tr } = useI18n<I18n, "en">();
  const state = props.state;
  const label =
    state.state === "merged"
      ? tr("pullRequest.state.merged")
      : state.state === "closed"
        ? tr("pullRequest.state.closed")
        : state.state === "draft"
          ? tr("pullRequest.state.draft")
          : state.queued
            ? tr("pullRequest.state.queued")
            : tr("pullRequest.state.open");
  const tone =
    state.state === "merged"
      ? "violet"
      : state.state === "closed"
        ? "red"
        : state.state === "draft"
          ? "neutral"
          : "green";
  const checks =
    state.checks === "failing"
      ? tr("pullRequest.checks.failing")
      : state.checks === "passing"
        ? tr("pullRequest.checks.passing")
        : state.checks === "pending"
          ? tr("pullRequest.checks.pending")
          : undefined;
  return (
    <span
      className="inline-flex items-center gap-1"
      data-testid="pull-request-state"
    >
      <Badge variant="tint" tone={tone}>
        {label}
      </Badge>
      {checks && state.state !== "merged" && state.state !== "closed" && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                aria-label={checks}
                className={`inline-block size-2 rounded-full ${
                  state.checks === "failing"
                    ? "bg-danger"
                    : state.checks === "passing"
                      ? "bg-success"
                      : "bg-warning"
                }`}
              />
            }
          />
          <TooltipContent>{checks}</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
};

export default PullRequestStateChip;
