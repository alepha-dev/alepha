import { Badge } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { UseCaseRunState } from "../../../../api/schemas/useCaseRunStateSchema.ts";

export interface RunStateBadgeProps {
  state: UseCaseRunState;
  stale?: boolean;
}

/**
 * A use case's last result (#E153): Passed, Failed, In development (a
 * failure while a covering quest is open) or Never run, and Stale beside it.
 */
const RunStateBadge = (props: RunStateBadgeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const tone = (
    {
      passed: "success",
      failed: "danger",
      in_development: "info",
      never_run: "neutral",
    } as const
  )[props.state];
  const key = (
    {
      passed: "requirements.run.state.passed",
      failed: "requirements.run.state.failed",
      in_development: "requirements.run.state.in_development",
      never_run: "requirements.run.state.never_run",
    } as const
  )[props.state];
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant="tint" tone={tone}>
        {tr(key)}
      </Badge>
      {props.stale ? (
        <Badge variant="tint" tone="warning">
          {tr("requirements.run.stale")}
        </Badge>
      ) : null}
    </span>
  );
};

export default RunStateBadge;
