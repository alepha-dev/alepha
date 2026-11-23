import { Badge, cn } from "@alepha/ui";

import type { HostJobResource } from "../../../../../api/schemas/hostJobResourceSchema.ts";
import { JOB_STATUS_ICON } from "./jobStatusIcon.ts";

export interface JobStatusBadgeProps {
  status: HostJobResource["status"];
}

/**
 * A job's status, coloured the way a command's is: a failure loud, an end
 * quiet, everything in flight outlined. Its glyph is the rail's (#Q4207),
 * a spinner while the job runs.
 */
const JobStatusBadge = ({ status }: JobStatusBadgeProps) => {
  const glyph = JOB_STATUS_ICON[status];
  const Icon = glyph.icon;
  return (
    <Badge
      variant={
        status === "failed" || status === "timed_out"
          ? "destructive"
          : status === "succeeded"
            ? "secondary"
            : "outline"
      }
      className="gap-1"
      data-testid="job-status"
      data-status={status}
    >
      <Icon
        className={cn(
          "size-3 shrink-0",
          status === "running" && "motion-safe:animate-spin",
        )}
        aria-hidden="true"
      />
      {status}
    </Badge>
  );
};

export default JobStatusBadge;
