import { cn } from "@alepha/ui/lib/utils";

import type { CiRun } from "../../api/schemas/ciRunSchema.ts";
import { CiIndicatorIcon } from "./CiIndicatorIcon.tsx";

export interface CiIndicatorProps {
  ci?: CiRun;
  /**
   * Side-bar form: an icon, or the percentage while it runs.
   */
  compact?: boolean;
}

/**
 * A branch's latest CI run: a percentage and a bar in weft while it runs,
 * then a green check or a red cross. Links to the run on GitHub.
 */
export const CiIndicator = (props: CiIndicatorProps) => {
  const ci = props.ci;
  if (!ci) {
    return props.compact ? null : (
      <span className="text-muted-foreground">-</span>
    );
  }

  const running = ci.status !== "completed";
  const progress = `${ci.progress ?? 0}%`;
  const title = `${ci.name}: ${running ? `${ci.status.replace("_", " ")}, ${progress}` : (ci.conclusion ?? ci.status)}`;

  if (props.compact) {
    return (
      <span title={title} className="flex shrink-0 items-center">
        {running ? (
          <span className="text-weft animate-weft font-mono text-[11px] tabular-nums">
            {ci.status === "queued" ? "..." : progress}
          </span>
        ) : (
          <CiIndicatorIcon ci={ci} />
        )}
      </span>
    );
  }

  const failed = ci.conclusion === "failure";
  const label = running
    ? ci.status === "queued"
      ? "Queued"
      : progress
    : ci.conclusion === "success"
      ? "Passed"
      : failed
        ? ci.jobs?.failed
          ? `Failed (${ci.jobs.failed})`
          : "Failed"
        : (ci.conclusion ?? ci.status);

  return (
    <a
      href={ci.url}
      target="_blank"
      rel="noreferrer"
      title={title}
      className="hover:text-foreground flex items-center gap-1.5 whitespace-nowrap"
    >
      {running ? (
        <>
          <span className="bg-weft animate-weft size-2 rounded-full" />
          <span className="bg-muted relative h-1 w-14 overflow-hidden rounded-full">
            <span
              className="bg-weft absolute inset-y-0 left-0 rounded-full transition-[width]"
              style={{ width: progress }}
            />
          </span>
          <span className="text-weft font-mono text-[12px] tabular-nums">
            {label}
          </span>
        </>
      ) : (
        <>
          <CiIndicatorIcon ci={ci} />
          <span className={cn(failed ? "text-fail" : "text-muted-foreground")}>
            {label}
          </span>
        </>
      )}
    </a>
  );
};
