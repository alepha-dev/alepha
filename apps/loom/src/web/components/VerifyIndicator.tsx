import { FlaskConical } from "lucide-react";

import type { VerifyRun } from "../../api/schemas/verifyRunSchema.ts";

export interface VerifyIndicatorProps {
  verify?: VerifyRun;
  /**
   * Side-bar form: the flask alone, orange while it runs.
   */
  compact?: boolean;
}

/**
 * A local `yarn v` started from this worktree: the step and a progress bar
 * in weft while it holds the machine's slot, its place in line while it
 * waits. The progress is an estimate from the steps' usual durations.
 */
export const VerifyIndicator = (props: VerifyIndicatorProps) => {
  const verify = props.verify;
  if (!verify) {
    return props.compact ? null : (
      <span className="text-muted-foreground">-</span>
    );
  }

  const title = verify.holding
    ? `yarn v is running here: ${verify.step ?? "starting"}, about ${verify.progress ?? 0}%`
    : `yarn v is queued here, ${verify.position === 1 ? "next" : `number ${verify.position}`} in line for the machine's slot`;

  if (props.compact) {
    return (
      <span title={title} className="flex shrink-0 items-center">
        <FlaskConical
          className={
            verify.holding
              ? "text-weft animate-weft size-3.5"
              : "text-muted-foreground size-3.5"
          }
        />
      </span>
    );
  }

  if (!verify.holding) {
    return (
      <span
        title={title}
        className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap"
      >
        <FlaskConical className="size-3.5" />
        queued #{verify.position}
      </span>
    );
  }

  const progress = `${verify.progress ?? 0}%`;
  return (
    <span
      title={`${title}, started ${verify.startedAt.slice(11, 19)} UTC`}
      className="flex min-w-0 flex-col gap-0.5 whitespace-nowrap"
    >
      <span className="flex items-center gap-1.5">
        <span className="bg-weft animate-weft size-2 rounded-full" />
        <span className="bg-muted relative h-1 w-12 overflow-hidden rounded-full">
          <span
            className="bg-weft absolute inset-y-0 left-0 rounded-full transition-[width]"
            style={{ width: progress }}
          />
        </span>
        <span className="text-weft font-mono text-[12px] tabular-nums">
          {progress}
        </span>
      </span>
      <span className="text-muted-foreground truncate text-[11px]">
        {verify.step ?? "starting"}
      </span>
    </span>
  );
};
