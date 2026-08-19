import { useI18n } from "alepha/react/i18n";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectEpicsProgressProps {
  epic: EpicResource;
}

/**
 * The Progress cell of the Epics list: a tick bar over the epic's quests
 * plus one line of prose saying what the ticks mean.
 *
 * The prose is status-dependent because "3 of 13 done" answers a different
 * question for each of the three statuses. A `planned` epic that has not
 * started reports how much is *specified* and that none of it is released
 * — the backlog gate (`EpicVisibilityService`) is exactly what "not
 * released" means, and quest counts alone never say it. A `done` epic
 * reports when it concluded, because by then the ratio is settled and the
 * date is the only part still worth reading. Only an `active` epic gets
 * the bucket breakdown.
 */
const ProjectEpicsProgress = (props: ProjectEpicsProgressProps) => {
  const i18n = useI18n<I18n, "en">();
  const { tr } = i18n;
  const { completed, inProgress, shelved, total } = props.epic.progress;
  // The four server buckets are disjoint (see `EpicController.computeProgress`),
  // so whatever they do not claim is a quest nobody has touched.
  const open = Math.max(0, total - completed - inProgress - shelved);

  if (total === 0) {
    return (
      <span className="text-muted-foreground text-xs">
        {tr("epic.progress.none")}
      </span>
    );
  }

  const caption =
    props.epic.status === "done" && props.epic.completedAt
      ? tr("epic.progress.concluded", {
          args: [String(i18n.l(props.epic.completedAt, { date: "ll" }))],
        })
      : props.epic.status === "planned" && completed === 0 && inProgress === 0
        ? tr("epic.progress.specified", { args: [String(total)] })
        : [
            completed > 0 &&
              tr("epic.progress.done", { args: [String(completed)] }),
            inProgress > 0 &&
              tr("epic.progress.inProgress", { args: [String(inProgress)] }),
            open > 0 && tr("epic.progress.open", { args: [String(open)] }),
            shelved > 0 &&
              tr("epic.progress.shelved", { args: [String(shelved)] }),
          ]
            .filter(Boolean)
            .join(" · ");

  return (
    <div className="flex min-w-40 flex-col gap-1.5">
      <div className="flex gap-0.5" aria-hidden="true">
        {buildTicks(completed, inProgress, open, shelved).map((tone, index) => (
          <span
            key={index}
            className={`h-1.5 flex-1 rounded-[1px] ${TICK_TONE[tone]}`}
          />
        ))}
      </div>
      <span className="text-muted-foreground text-xs">{caption}</span>
    </div>
  );
};

export default ProjectEpicsProgress;

type Tone = "completed" | "inProgress" | "open" | "shelved";

/**
 * A `done` tick reads as the primary colour, an in-flight one as a faded
 * version of it, and the two kinds of not-done are separated on purpose:
 * shelved work is declined rather than outstanding, so it must not look
 * like a quest still waiting its turn.
 */
const TICK_TONE: Record<Tone, string> = {
  completed: "bg-primary",
  inProgress: "bg-primary/45",
  open: "bg-muted-foreground/30",
  shelved: "bg-muted-foreground/60",
};

/**
 * Widest bar we draw. Past this the bar is downsampled rather than grown:
 * one tick per quest is legible for the epics people actually write, and a
 * 200-quest epic would otherwise render 200 sub-pixel slivers.
 */
const MAX_TICKS = 24;

/**
 * One tone per quest, ordered done → in progress → open → shelved, then
 * downsampled by index to at most {@link MAX_TICKS}.
 *
 * Downsampling the expanded array rather than rounding each bucket to a
 * tick count keeps the segments proportional without the rounding drift
 * that makes four percentages fail to add up to the width.
 */
const buildTicks = (
  completed: number,
  inProgress: number,
  open: number,
  shelved: number,
): Tone[] => {
  const ticks: Tone[] = [
    ...Array<Tone>(completed).fill("completed"),
    ...Array<Tone>(inProgress).fill("inProgress"),
    ...Array<Tone>(open).fill("open"),
    ...Array<Tone>(shelved).fill("shelved"),
  ];
  if (ticks.length <= MAX_TICKS) {
    return ticks;
  }
  return Array.from(
    { length: MAX_TICKS },
    (_, i) => ticks[Math.floor((i * ticks.length) / MAX_TICKS)],
  );
};
