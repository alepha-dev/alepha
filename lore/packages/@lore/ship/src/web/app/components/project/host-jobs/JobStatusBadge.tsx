import { Badge } from "@alepha/ui";
import type { HostJobResource } from "@lore/core/schemas";

export interface JobStatusBadgeProps {
  status: HostJobResource["status"];
}

/**
 * A job's status, coloured the way a command's is: a failure loud, an end
 * quiet, everything in flight outlined.
 */
const JobStatusBadge = ({ status }: JobStatusBadgeProps) => (
  <Badge
    variant={
      status === "failed" || status === "timed_out"
        ? "destructive"
        : status === "succeeded"
          ? "secondary"
          : "outline"
    }
    data-testid="job-status"
  >
    {status}
  </Badge>
);

export default JobStatusBadge;
