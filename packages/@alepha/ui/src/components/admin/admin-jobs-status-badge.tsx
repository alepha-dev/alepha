import { Badge } from "@alepha/ui/components/ui/badge";
import type { JobExecutionResource } from "alepha/api/jobs";
import { useI18n } from "alepha/react/i18n";

export interface JobStatusBadgeProps {
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
export const JobStatusBadge = (props: JobStatusBadgeProps) => {
  const { tr } = useI18n();
  return (
    <Badge variant={VARIANTS[props.status]}>
      {tr(`admin.jobs.status.${props.status}` as any, {
        default: props.status,
      })}
    </Badge>
  );
};
