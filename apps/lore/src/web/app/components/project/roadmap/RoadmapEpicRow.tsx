import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";
import { ArrowUp } from "lucide-react";

import type { RoadmapEpic } from "@/api/schemas/roadmapEpicSchema.ts";
import {
  STATUS_ICONS,
  STATUS_LABEL_KEYS,
  STATUS_TONE,
} from "@/web/app/components/project/epics/epicStatus.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import RoadmapEpicRowSegment from "./RoadmapEpicRowSegment.tsx";

export interface RoadmapEpicRowProps {
  epic: RoadmapEpic;
}

/**
 * One epic inside a release card: what it is called, how far along it is, and
 * whether it has started.
 *
 * **The status chip is not decoration.** A `planned` epic has 0 completed by
 * definition, and without the chip its empty bar reads as stalled rather than
 * as not begun - which is the single most misleading thing a roadmap can say.
 * That is also why planned epics are shown at all: an epic that is specified
 * and not started is exactly what a roadmap is for.
 *
 * ⚠️ The denominator here is the EPIC one, where `shelved` sits INSIDE
 * `total`, so the untouched remainder is
 * `total - completed - inProgress - shelved`. The release bar wrapping this
 * row uses the opposite convention. Two rollups, same field names, different
 * denominators; see `RoadmapService.epicProgressOf`.
 *
 * No link. The epic page is member-gated, and this row is rendered on a page
 * a stranger may be reading.
 */
const RoadmapEpicRow = (props: RoadmapEpicRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { number, title, status, progress, dependsOnNumber } = props.epic;
  const { completed, inProgress, shelved, total } = progress;
  const open = Math.max(0, total - completed - inProgress - shelved);
  const Icon = STATUS_ICONS[status];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground font-mono text-xs">
          {tr("roadmap.epic.ref", { args: [String(number)] })}
        </span>
        <span className="text-sm font-medium">{title}</span>
        <Badge variant="tint" tone={STATUS_TONE[status]}>
          <Icon className="size-3" />
          {tr(STATUS_LABEL_KEYS[status])}
        </Badge>
        {/* ⚠️ The order DRAWN, which is the whole reason `epics.dependsOn`
            exists: it used to live in prose ("depends on epic #14 landing
            first") that could not be rendered, sorted or checked.

            Advisory, and the wording says so. "After Epic 7" states an
            intended order; "Blocked by Epic 7" would claim an enforcement
            that does not exist - nothing refuses a status change because of
            this field, by decision recorded on the column. The rows are also
            sorted so the predecessor is already above this one. */}
        {dependsOnNumber !== undefined ? (
          <Badge variant="tint" tone="neutral">
            <ArrowUp className="size-3" />
            {tr("roadmap.epic.after", { args: [String(dependsOnNumber)] })}
          </Badge>
        ) : null}
      </div>

      {total === 0 ? (
        <span className="text-muted-foreground text-xs">
          {tr("epic.progress.none")}
        </span>
      ) : (
        <div className="flex items-center gap-3">
          <div
            className="flex h-1.5 min-w-24 flex-1 gap-0.5"
            // The ratio beside it states the same fact in words, so the bar is
            // the redundant half rather than the only one.
            aria-hidden="true"
          >
            <RoadmapEpicRowSegment count={completed} className="bg-primary" />
            <RoadmapEpicRowSegment
              count={inProgress}
              className="bg-primary/45"
            />
            <RoadmapEpicRowSegment
              count={open}
              className="bg-muted-foreground/30"
            />
            <RoadmapEpicRowSegment
              count={shelved}
              className="bg-muted-foreground/60"
            />
          </div>
          <span className="text-muted-foreground shrink-0 font-mono text-xs">
            {tr("roadmap.epic.ratio", {
              args: [String(completed), String(total)],
            })}
          </span>
        </div>
      )}
    </div>
  );
};

export default RoadmapEpicRow;
