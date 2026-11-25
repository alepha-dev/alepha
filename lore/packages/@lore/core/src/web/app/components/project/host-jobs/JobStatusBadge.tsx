import { Badge, cn } from "@alepha/ui";

import type { HostJobResource } from "../../../../../api/schemas/hostJobResourceSchema.ts";
import { JOB_STATUS_ICON } from "./jobStatusIcon.ts";

export interface JobStatusBadgeProps {
  status: HostJobResource["status"];
}

/**
 * A job's status as a tinted chip in its status's hue (#Q4306): queued and
 * cancelled neutral, running amber, succeeded green, failed and timed out
 * red, the colours its glyph has on the rail (`JOB_STATUS_ICON`, #Q4207),
 * so a long list of jobs reads at a glance. A spinner while the job runs.
 */
const JobStatusBadge = (props: JobStatusBadgeProps) => {
  const glyph = JOB_STATUS_ICON[props.status];
  const Icon = glyph.icon;
  return (
    <Badge
      variant="tint"
      tone={glyph.tone}
      className="gap-1"
      data-testid="job-status"
      data-status={props.status}
      data-tone={glyph.tone}
    >
      <Icon
        className={cn(
          "size-3 shrink-0",
          glyph.className,
          props.status === "running" && "motion-safe:animate-spin",
        )}
        aria-hidden="true"
      />
      {props.status}
    </Badge>
  );
};

export default JobStatusBadge;
