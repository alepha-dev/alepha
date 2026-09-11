import type { BadgeTone } from "@alepha/ui/components/ui/badge";
import type { JobExecutionResource } from "alepha/api/jobs";
import {
  CalendarClock,
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock,
  Play,
  type LucideIcon,
} from "lucide-react";

type JobStatus = JobExecutionResource["status"];

/**
 * The tone each job execution status wears, on the scale Lore's quest and
 * epic statuses use (#Q2247): not started is `info`, in progress is
 * `warning`, done is `success`, failed is `danger`, and `neutral` is a state
 * nobody needs to act on.
 *
 * ⚠️ `cancelled` is `neutral`, not a failure: somebody stopped it on
 * purpose, and tinting it like an error sends an operator looking for a
 * problem that is not there. The same call `skipped` gets on notifications.
 *
 * A `Record` over the status union, so a status added to the entity is a
 * type error here rather than a chip that silently falls back.
 */
export const JOB_STATUS_TONE: Record<JobStatus, BadgeTone> = {
  pending: "info",
  scheduled: "info",
  running: "warning",
  ok: "success",
  error: "danger",
  cancelled: "neutral",
};

/**
 * The glyph each status wears. Not decoration: `pending` and `scheduled`
 * share a tone, and the glyph is what tells "queued now" from "waiting for
 * its time". It also keeps the column readable in monochrome.
 */
export const JOB_STATUS_ICON: Record<JobStatus, LucideIcon> = {
  pending: Clock,
  scheduled: CalendarClock,
  running: Play,
  ok: CircleCheck,
  error: CircleX,
  cancelled: CircleMinus,
};
