import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";

export interface WorkflowStatusBadgeProps {
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
export const WorkflowStatusBadge = (props: WorkflowStatusBadgeProps) => {
  const { tr } = useI18n();
  return (
    <Badge variant={VARIANTS[props.status] ?? "outline"}>
      {tr(`admin.workflows.status.${props.status}` as any, {
        default: props.status,
      })}
    </Badge>
  );
};
