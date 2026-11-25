import {
  CircleCheck,
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
 * rail, the job's own header and `JobStatusBadge`, so a status looks the
 * same everywhere: `className` colours a bare glyph, `tone` the badge's tint
 * in the same hue (#Q4306). A running job's spinner is the page's
 * animation; it stops under reduced motion (`motion-safe`).
 */
export const JOB_STATUS_ICON: Record<
  HostJobResource["status"],
  {
    icon: LucideIcon;
    className: string;
    tone: "neutral" | "warning" | "success" | "danger";
  }
> = {
  queued: { icon: Clock, className: "text-muted-foreground", tone: "neutral" },
  running: {
    icon: Loader2,
    className: "text-warning motion-safe:animate-spin",
    tone: "warning",
  },
  succeeded: { icon: CircleCheck, className: "text-success", tone: "success" },
  failed: { icon: CircleX, className: "text-danger", tone: "danger" },
  cancelled: {
    icon: CircleSlash,
    className: "text-muted-foreground",
    tone: "neutral",
  },
  timed_out: { icon: TimerOff, className: "text-danger", tone: "danger" },
};

/**
 * Whether a job may still change: polled while it is.
 */
export const jobInFlight = (status: HostJobResource["status"]): boolean =>
  status === "queued" || status === "running";
