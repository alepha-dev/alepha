import { Badge } from "@alepha/ui/components/ui/badge";

import { useWorkflowStatusLabels } from "./admin-workflows-status-labels.ts";

export interface AdminWorkflowsStatusBadgeProps {
  /**
   * Accepts both execution statuses and step statuses — the two sets
   * overlap on everything but `timed_out` / `skipped`.
   */
  status: string;
}

const VARIANTS: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending: "secondary",
  running: "default",
  completed: "outline",
  skipped: "outline",
  failed: "destructive",
  timed_out: "destructive",
  compensating: "secondary",
  compensated: "outline",
  compensation_failed: "destructive",
  cancelled: "outline",
};

/**
 * Coloured badge for a workflow execution or step status.
 */
export const AdminWorkflowsStatusBadge = (
  props: AdminWorkflowsStatusBadgeProps,
) => {
  const labels = useWorkflowStatusLabels();
  return (
    <Badge variant={VARIANTS[props.status] ?? "outline"}>
      {labels[props.status] ?? props.status}
    </Badge>
  );
};
