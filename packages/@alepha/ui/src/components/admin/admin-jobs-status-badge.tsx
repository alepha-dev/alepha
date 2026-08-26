import { Badge } from "@alepha/ui/components/ui/badge";
import type { JobExecutionResource } from "alepha/api/jobs";

import { useJobStatusLabels } from "./admin-jobs-status-labels.ts";

export interface AdminJobsStatusBadgeProps {
  status: JobExecutionResource["status"];
}

const VARIANTS: Record<
  JobExecutionResource["status"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending: "secondary",
  scheduled: "secondary",
  running: "default",
  ok: "outline",
  error: "destructive",
  cancelled: "outline",
};

/**
 * Coloured badge for a job execution's status.
 */
export const AdminJobsStatusBadge = (props: AdminJobsStatusBadgeProps) => {
  const labels = useJobStatusLabels();
  return (
    <Badge variant={VARIANTS[props.status]}>
      {labels[props.status] ?? props.status}
    </Badge>
  );
};
