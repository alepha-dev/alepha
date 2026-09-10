import { CircleCheck, CircleSlash, CircleX, Clock } from "lucide-react";

import type { CiRun } from "../../api/schemas/ciRunSchema.ts";

export interface CiIndicatorIconProps {
  ci: CiRun;
}

/**
 * The icon for a run: a clock until it finishes, then a check, a cross, or a
 * slash for cancelled and skipped.
 */
export const CiIndicatorIcon = (props: CiIndicatorIconProps) => {
  if (props.ci.status !== "completed") {
    return <Clock className="text-muted-foreground size-3.5" />;
  }
  if (props.ci.conclusion === "success") {
    return <CircleCheck className="text-ok size-3.5" />;
  }
  if (props.ci.conclusion === "failure") {
    return <CircleX className="text-fail size-3.5" />;
  }
  return <CircleSlash className="text-muted-foreground size-3.5" />;
};
