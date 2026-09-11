import { Badge } from "@alepha/ui/components/ui/badge";
import type { JobExecutionResource } from "alepha/api/jobs";

import { useJobStatusLabels } from "./admin-jobs-status-labels.ts";
import { JOB_STATUS_ICON, JOB_STATUS_TONE } from "./admin-jobs-status-tones.ts";

export interface AdminJobsStatusBadgeProps {
  status: JobExecutionResource["status"];
}

/**
 * A job execution's status, as a tinted chip with a glyph: the design of
 * `AdminNotificationsStatusBadge` and of Lore's statuses (#Q2247). The tone
 * and the glyph come from `admin-jobs-status-tones`.
 */
export const AdminJobsStatusBadge = (props: AdminJobsStatusBadgeProps) => {
  const labels = useJobStatusLabels();
  const Icon = JOB_STATUS_ICON[props.status];

  return (
    // A status this build does not know about still gets a chip: neutral,
    // no glyph, its raw value as the label. Same rule as notifications.
    <Badge variant="tint" tone={JOB_STATUS_TONE[props.status] ?? "neutral"}>
      {Icon ? <Icon className="size-3" /> : null}
      {labels[props.status] ?? props.status}
    </Badge>
  );
};
