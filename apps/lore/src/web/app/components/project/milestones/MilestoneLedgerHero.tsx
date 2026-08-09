import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { cn } from "@alepha/ui/lib/utils";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Square } from "lucide-react";
import type { I18n } from "@/web/app/services/I18n.ts";
import type { MilestoneWithCount } from "./ProjectMilestones.tsx";

export interface MilestoneLedgerHeroProps {
  milestone: MilestoneWithCount;
  questCount: number;
  zoneCount: number;
  contributorCount: number;
  onOpenDetail: () => void;
  /**
   * Opens the close-milestone modal. This lives here rather than in a page
   * header because the banner is the page's statement of current state, and
   * closing is the one action that changes it — the mirror of Start Milestone
   * on {@link MilestoneEmptyBanner}. It is also the only close affordance on
   * the page, so it cannot be dropped without stranding `closeMilestone`.
   */
  onClose: () => void;
}

/**
 * The band that sits above the changelog while a milestone is recording:
 * number medallion with a live pulse, what it is, how much of its window is
 * spent, and the three counters the changelog rolls up to.
 *
 * The progress bar is time spent, not work done — a milestone has no
 * denominator of planned quests, only a window that closes.
 */
const MilestoneLedgerHero = (props: MilestoneLedgerHeroProps) => {
  const { milestone } = props;
  const { tr } = useI18n<I18n, "en">();
  const i18n = useI18n();
  const dt = useInject(DateTimeProvider);
  const tags = milestone.tags ?? [];

  const startedAt = new Date(milestone.createdAt).getTime();
  const ageMs = Math.max(0, dt.nowMillis() - startedAt);
  const totalMs =
    milestone.closesAt != null
      ? Math.max(1, new Date(milestone.closesAt).getTime() - startedAt)
      : null;
  const progress =
    totalMs != null ? Math.min(100, Math.round((ageMs / totalMs) * 100)) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      // Without an explicit label the banner's accessible name is computed
      // from its contents, which now include the Close Milestone button —
      // so a query for that button matched the banner too.
      aria-label={milestone.title}
      onClick={props.onOpenDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onOpenDetail();
        }
      }}
      className="bg-card border-border flex cursor-pointer flex-col gap-6 border-b border-l-[3px] border-l-green-600 px-5 py-5 text-left transition-colors lg:flex-row lg:items-center lg:gap-7 lg:px-7"
    >
      <div className="relative flex size-13 shrink-0 items-center justify-center rounded-full bg-green-600 text-xl font-bold text-white">
        {milestone.number}
        <span className="ring-card absolute -bottom-px -right-px size-3 animate-pulse rounded-full bg-green-400 ring-2" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-green-600 dark:text-green-400">
          {tr("milestone.ledger.recording")}
          <span className="text-muted-foreground truncate font-medium tracking-[0.12em]">
            {tr("milestone.ledger.started", {
              args: [dt.of(milestone.createdAt).fromNow()],
            })}
          </span>
        </div>
        <h2 className="mt-1.5 truncate text-[22px] font-semibold tracking-[-0.015em]">
          {milestone.title}
        </h2>
        {tags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="font-mono text-[11px]"
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* The bar measures the window, so it is only drawn when there is one.
          A manual-close milestone has no deadline and therefore no
          denominator — rendering an empty track and a dash reads as broken
          rather than as "no deadline". */}
      <div className="shrink-0 lg:w-52">
        {progress != null ? (
          <>
            <div className="text-muted-foreground flex justify-between text-[10.5px] uppercase tracking-[0.1em]">
              <span>{tr("milestone.hero.progress")}</span>
              <span className="font-mono">{progress}%</span>
            </div>
            <div className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  progress >= 95
                    ? "bg-red-500"
                    : progress >= 70
                      ? "bg-amber-500"
                      : "bg-green-600",
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
          </>
        ) : (
          <div className="text-muted-foreground text-[10.5px] uppercase tracking-[0.1em]">
            {tr("milestone.ledger.window")}
          </div>
        )}
        <div className="text-muted-foreground mt-1.5 text-[11.5px]">
          {milestone.closesAt
            ? tr("milestone.ledger.autoCloses", {
                args: [
                  String(i18n.l(milestone.closesAt, { date: "ll" })),
                  dt.of(milestone.closesAt).fromNow(),
                ],
              })
            : tr("milestone.ledger.manualOnly")}
        </div>
      </div>

      {/* Counters and the close action share one right-hand cluster rather
          than each taking a top-level column: with the page header gone this
          band carries everything, and a fifth column squeezed the title. */}
      <div className="border-border flex shrink-0 items-center gap-6 lg:border-l lg:pl-6">
        <Stat
          label={tr("milestone.ledger.stat.quests")}
          value={props.questCount}
        />
        <Stat
          label={tr("milestone.ledger.stat.zones")}
          value={props.zoneCount}
        />
        <Stat
          label={tr("milestone.ledger.stat.members")}
          value={props.contributorCount}
        />
        {/* Mirrors where Start Milestone sits on the empty banner: the one
            action that changes the state the banner reports. The banner
            itself opens the detail sheet, so this has to stop the click
            from reaching it. */}
        <Button
          variant="outline"
          className="border-amber-500/60 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
          onClick={(e) => {
            e.stopPropagation();
            props.onClose();
          }}
        >
          <Square className="size-4" />
          {tr("milestone.close")}
        </Button>
      </div>
    </div>
  );
};

interface StatProps {
  label: string | number;
  value: number;
}

const Stat = (props: StatProps) => (
  <div>
    <div className="text-muted-foreground text-[10px] uppercase tracking-[0.1em]">
      {props.label}
    </div>
    <div className="mt-0.5 text-[22px] font-bold">{props.value}</div>
  </div>
);

export default MilestoneLedgerHero;
