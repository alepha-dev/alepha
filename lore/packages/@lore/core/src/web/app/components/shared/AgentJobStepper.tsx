import { cn } from "@alepha/ui";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { TriangleAlert } from "lucide-react";

import type { AgentJobPaceValue } from "../../../../api/schemas/agentJobPaceSchema.ts";
import type { AgentJobStepsValue } from "../../../../api/schemas/agentJobStepsSchema.ts";
import type { I18n } from "../../services/I18n.ts";

export interface AgentJobStepperProps {
  steps: AgentJobStepsValue;
  /**
   * The run's pace (#Q4436): the steps left as a range, and the warning
   * when they may not fit before the timeout. Shown while it runs.
   */
  pace?: AgentJobPaceValue;
  /**
   * The job still runs: the current quest, the time since the last step,
   * the elapsed time and the wrapping up line show only then. An ended job
   * shows its final count.
   */
  running: boolean;
  /**
   * The job's start and its timeout, for "40 min of 12 h".
   */
  startedAt?: string;
  timeoutSeconds?: number;
  /**
   * Segments and "4/7" alone, for a table row.
   */
  compact?: boolean;
  /**
   * The quest to mark among the segments: the one a hover card was opened
   * from.
   */
  mark?: number;
  className?: string;
}

/**
 * A running agent job's steps as a stepped bar (#Q4434, epic #E181): one
 * segment per quest it accepted, in accept order, filled as quests
 * complete, then one empty segment per quest of its epic it has not
 * accepted yet; inside the current quest, its objectives as sub-steps.
 * Completions come in bursts and objective ticks are finer, so every
 * accepted quest not yet completed fills by its ticks, below full (#Q4544):
 * the current one in its own shade, the others lighter. A `work-quest` job
 * has one segment, and its objectives are the steps.
 *
 * Beside it, "quest 4 of 7", the time since the last step, and the elapsed
 * time against the ceiling as two figures, never as a fraction: a work run
 * gets 12 h, and that bar would sit near empty for the whole run. With every
 * accepted quest done and nothing pending while the job still runs, the bar
 * is full and says the job is wrapping up: review, checks and merge follow,
 * which Lore does not see yet.
 */
const AgentJobStepper = (props: AgentJobStepperProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dateTime = useInject(DateTimeProvider);
  const { steps } = props;
  // Nothing to count: a quest with no objectives, or all of them waived.
  if (steps.total === 0) return null;
  const now = dateTime.nowMillis();
  const byObjective = steps.unit === "objective";
  const allDone =
    steps.total > 0 && steps.done >= steps.total && steps.pending.length === 0;
  const wrapping = props.running && allDone;
  const currentIndex = steps.quests.findIndex(
    (quest) => quest.shortId === steps.current,
  );
  const current = currentIndex >= 0 ? steps.quests[currentIndex] : undefined;

  // "Quest k of N": the current quest's place, else the next one to come.
  const position = Math.min(
    steps.total,
    byObjective
      ? steps.done + (props.running && !allDone ? 1 : 0)
      : currentIndex >= 0 && props.running
        ? currentIndex + 1
        : steps.done + (props.running && !allDone ? 1 : 0),
  );

  const segments: Array<{
    key: string;
    fill: number;
    shortId?: number;
    current?: boolean;
    title?: string;
  }> = byObjective
    ? [
        {
          key: "one",
          fill: steps.total ? steps.done / steps.total : 0,
          shortId: steps.quests[0]?.shortId,
          current: props.running,
          title: steps.quests[0]?.title,
        },
      ]
    : [
        ...steps.quests.map((quest) => {
          const open = quest.objectives.total - quest.objectives.waived;
          const isCurrent = props.running && quest.shortId === steps.current;
          // Every accepted quest fills by its ticks, not only the current
          // one: a run may leave its completions to the end, and a quest it
          // worked first would otherwise read as not started (#Q4544).
          // Capped below full, so a completed quest still looks different.
          return {
            key: `q${quest.shortId}`,
            fill: quest.completedAt
              ? 1
              : open > 0
                ? Math.min(quest.objectives.done / open, 0.95)
                : 0,
            shortId: quest.shortId,
            current: isCurrent,
            title: `#${quest.shortId} ${quest.title}`,
          };
        }),
        ...steps.pending.map((quest) => ({
          key: `p${quest.shortId}`,
          fill: 0,
          shortId: quest.shortId,
          title: `#${quest.shortId} ${quest.title}`,
        })),
      ];

  const bar = (
    <div
      className={cn("flex w-full gap-0.5", props.compact ? "h-1.5" : "h-2")}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={steps.total}
      aria-valuenow={steps.done}
      aria-label={tr("jobs.steps.aria", {
        args: [String(steps.done), String(steps.total)],
      })}
      data-testid="job-steps-bar"
    >
      {segments.map((segment) => (
        <span
          key={segment.key}
          title={segment.title}
          className={cn(
            "bg-foreground/10 relative min-w-1 flex-1 overflow-hidden rounded-sm",
            segment.shortId !== undefined &&
              segment.shortId === props.mark &&
              "ring-ring ring-offset-card ring-2 ring-offset-1",
          )}
          data-testid="job-steps-segment"
          data-done={segment.fill >= 1 ? "true" : undefined}
          data-current={segment.current ? "true" : undefined}
          data-marked={
            segment.shortId !== undefined && segment.shortId === props.mark
              ? "true"
              : undefined
          }
        >
          <span
            className={cn(
              "bg-primary absolute inset-y-0 left-0 rounded-sm transition-[width]",
              segment.fill < 1 &&
                (segment.current ? "bg-primary/70" : "bg-primary/40"),
            )}
            style={{ width: `${Math.round(segment.fill * 100)}%` }}
          />
        </span>
      ))}
    </div>
  );

  const warning = props.running && props.pace?.warning;
  const warningIcon = warning ? (
    <TriangleAlert
      className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500"
      aria-hidden
    />
  ) : null;

  if (props.compact) {
    return (
      <span
        className={cn("flex w-28 items-center gap-1.5", props.className)}
        data-testid="job-steps"
      >
        {bar}
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {steps.done}/{steps.total}
        </span>
        {warning && (
          <span
            title={tr("jobs.pace.warning")}
            aria-label={tr("jobs.pace.warning")}
            data-testid="job-pace-warning"
          >
            {warningIcon}
          </span>
        )}
      </span>
    );
  }

  const objectivesOf = byObjective ? steps.quests[0] : current;
  const subSteps =
    props.running && objectivesOf && objectivesOf.objectives.total > 0
      ? objectivesOf.objectives
      : undefined;
  const sinceLast =
    props.running && steps.lastStepAt
      ? (now - Date.parse(steps.lastStepAt)) / 1000
      : undefined;
  const elapsed =
    props.running && props.startedAt
      ? (now - Date.parse(props.startedAt)) / 1000
      : undefined;

  const headline = wrapping
    ? tr("jobs.steps.wrapping")
    : !props.running
      ? tr(
          byObjective ? "jobs.steps.doneObjectives" : "jobs.steps.doneQuests",
          {
            args: [String(steps.done), String(steps.total)],
          },
        )
      : tr(byObjective ? "jobs.steps.objective" : "jobs.steps.quest", {
          args: [String(Math.max(position, 1)), String(steps.total)],
        });

  return (
    <div
      className={cn("flex flex-col gap-1.5", props.className)}
      data-testid="job-steps"
    >
      {bar}
      <span
        className="text-sm font-medium tabular-nums"
        data-testid="job-steps-text"
      >
        {headline}
      </span>
      {props.running && current && !wrapping && !byObjective && (
        <span
          className="text-muted-foreground truncate text-xs"
          data-testid="job-steps-current"
        >
          #{current.shortId} {current.title}
        </span>
      )}
      {subSteps && !byObjective && (
        <div
          className="flex items-center gap-1"
          data-testid="job-steps-objectives"
          aria-label={tr("jobs.steps.objectives", {
            args: [String(subSteps.done), String(subSteps.total)],
          })}
        >
          {Array.from({ length: subSteps.total }, (_, index) => (
            <span
              key={index}
              className={cn(
                "size-1.5 rounded-full",
                index < subSteps.done
                  ? "bg-primary"
                  : index < subSteps.done + subSteps.waived
                    ? "bg-foreground/30"
                    : "bg-foreground/10",
              )}
            />
          ))}
          <span className="text-muted-foreground ms-1 text-xs tabular-nums">
            {tr("jobs.steps.objectives", {
              args: [String(subSteps.done), String(subSteps.total)],
            })}
          </span>
        </div>
      )}
      {props.running && props.pace && !wrapping && (
        <span
          className="text-muted-foreground text-xs"
          data-testid="job-pace-range"
        >
          {tr(byObjective ? "jobs.pace.objectives" : "jobs.pace.quests", {
            args: [
              shortDuration(props.pace.low * 60),
              shortDuration(props.pace.high * 60),
              String(props.pace.left),
            ],
          })}
        </span>
      )}
      {warning && (
        <p
          className="text-foreground flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs"
          data-testid="job-pace-warning"
        >
          <span className="mt-0.5">{warningIcon}</span>
          <span>{tr("jobs.pace.warning")}</span>
        </p>
      )}
      {(sinceLast !== undefined || elapsed !== undefined) && (
        <span
          className="text-muted-foreground flex flex-wrap gap-x-2 text-xs tabular-nums"
          data-testid="job-steps-time"
        >
          {sinceLast !== undefined && !wrapping && (
            <span>
              {tr("jobs.steps.lastStep", { args: [shortDuration(sinceLast)] })}
            </span>
          )}
          {elapsed !== undefined && (
            <span data-testid="job-steps-elapsed">
              {props.timeoutSeconds
                ? tr("jobs.steps.elapsedOf", {
                    args: [
                      shortDuration(elapsed),
                      shortDuration(props.timeoutSeconds),
                    ],
                  })
                : shortDuration(elapsed)}
            </span>
          )}
        </span>
      )}
    </div>
  );
};

/**
 * `45 s`, `12 min`, `1 h 5 min`, `12 h`.
 */
const shortDuration = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
};

export default AgentJobStepper;
