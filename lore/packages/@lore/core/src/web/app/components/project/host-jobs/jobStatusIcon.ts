import {
  CircleCheck,
  CirclePause,
  CircleSlash,
  CircleX,
  Clock,
  Loader2,
  type LucideIcon,
  TimerOff,
} from "lucide-react";

import type { HostJobResource } from "../../../../../api/schemas/hostJobResourceSchema.ts";

/**
 * One glyph and one colour per job status (#Q4207), read by the history
 * rail and the job's own header, so a status looks the same in both. A
 * running job's spinner is the page's animation; it stops under reduced
 * motion (`motion-safe`).
 */
export const JOB_STATUS_ICON: Record<
  HostJobResource["status"],
  { icon: LucideIcon; className: string }
> = {
  queued: { icon: Clock, className: "text-muted-foreground" },
  running: {
    icon: Loader2,
    className: "text-warning motion-safe:animate-spin",
  },
  succeeded: { icon: CircleCheck, className: "text-success" },
  failed: { icon: CircleX, className: "text-danger" },
  cancelled: { icon: CircleSlash, className: "text-muted-foreground" },
  timed_out: { icon: TimerOff, className: "text-danger" },
  paused: { icon: CirclePause, className: "text-warning" },
};

/**
 * Whether a job may still change: polled while it is.
 */
export const jobInFlight = (status: HostJobResource["status"]): boolean =>
  status === "queued" || status === "running";
