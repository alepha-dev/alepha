import type { JobRegistration } from "alepha/api/jobs";
import { useI18n } from "alepha/react/i18n";
import { CalendarClock, Layers, Zap } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../core/Tooltip.tsx";

export interface AdminJobsTypeIconProps {
  type: JobRegistration["type"];
  className?: string;
}

/**
 * A job's effective mode as an icon, with a tooltip saying what it means.
 *
 * `type` is what actually runs, not what was declared: a queue job reads
 * "direct" in any app that did not load `AlephaApiJobsQueue`.
 */
export const AdminJobsTypeIcon = (props: AdminJobsTypeIconProps) => {
  const { tr } = useI18n();
  const labels: Record<JobRegistration["type"], string> = {
    cron: tr("admin.jobs.type.cron", {
      default: "Scheduled, runs on its cron",
    }),
    queue: tr("admin.jobs.type.queue", {
      default: "Queued, runs when pushed, through the queue",
    }),
    direct: tr("admin.jobs.type.direct", {
      default: "Runs in process when pushed",
    }),
  };
  const Icon =
    props.type === "cron"
      ? CalendarClock
      : props.type === "queue"
        ? Layers
        : Zap;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="img"
              aria-label={labels[props.type]}
              data-job-type={props.type}
              className="text-muted-foreground inline-flex shrink-0"
            />
          }
        >
          <Icon className={props.className ?? "size-4"} aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{labels[props.type]}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
