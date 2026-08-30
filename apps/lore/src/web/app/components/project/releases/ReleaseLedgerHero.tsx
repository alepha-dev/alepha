import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { cn } from "@alepha/ui/lib/utils";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Pencil, Square } from "lucide-react";

import type { I18n } from "@/web/app/services/I18n.ts";

import type { ReleaseWithCount } from "./ProjectReleases.tsx";

export interface ReleaseLedgerHeroProps {
  release: ReleaseWithCount;
  questCount: number;
  areaCount: number;
  contributorCount: number;
  onOpenDetail: () => void;
  /**
   * Opens the close-release modal. This lives here rather than in a page
   * header because the banner is the page's statement of current state, and
   * closing is the one action that changes it — the mirror of Start Release
   * on {@link ReleaseEmptyBanner}. It is also the only close affordance on
   * the page, so it cannot be dropped without stranding `closeRelease`.
   */
  onClose: () => void;
}

/**
 * The band that sits above the changelog while a release is recording:
 * number medallion with a live pulse, what it is, how much of its window is
 * spent, and the three counters the changelog rolls up to.
 *
 * The progress bar is time spent, not work done — a release has no
 * denominator of planned quests, only a window that closes.
 */
const ReleaseLedgerHero = (props: ReleaseLedgerHeroProps) => {
  const { release } = props;
  const { tr } = useI18n<I18n, "en">();
  const i18n = useI18n();
  const dt = useInject(DateTimeProvider);
  const tags = release.tags ?? [];

  const startedAt = new Date(release.createdAt).getTime();
  const ageMs = Math.max(0, dt.nowMillis() - startedAt);
  const totalMs =
    release.closesAt != null
      ? Math.max(1, new Date(release.closesAt).getTime() - startedAt)
      : null;
  const progress =
    totalMs != null ? Math.min(100, Math.round((ageMs / totalMs) * 100)) : null;

  return (
    <div className="bg-card border-border flex flex-col gap-6 border-b px-5 py-5 transition-colors lg:flex-row lg:items-center lg:gap-7 lg:px-7">
      <div className="relative flex size-13 shrink-0 items-center justify-center rounded-full bg-green-600 text-xl font-bold text-white">
        {release.number}
        <span className="ring-card absolute -right-px -bottom-px size-3 animate-pulse rounded-full bg-green-400 ring-2" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5 text-[10.5px] font-semibold tracking-[0.16em] text-green-600 uppercase dark:text-green-400">
          {tr("release.ledger.recording")}
          <span className="text-muted-foreground truncate font-medium tracking-[0.12em]">
            {tr("release.ledger.started", {
              args: [dt.of(release.createdAt).fromNow()],
            })}
          </span>
          {/* The banner used to be one big click target opening this sheet.
              A whole-card hit area announces nothing, cannot be reached by
              keyboard as itself, and forced every control inside it — the
              Close button below — to stop propagation just to stay usable.
              An icon button says what it does and frees the band to grow
              more actions. The label is a real accessible name, not decoration:
              a pencil alone names nothing. */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground -my-1 size-6 shrink-0"
                  aria-label={String(tr("release.ledger.edit"))}
                  onClick={props.onOpenDetail}
                />
              }
            >
              <Pencil className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>{tr("release.ledger.edit")}</TooltipContent>
          </Tooltip>
        </div>
        <h2 className="mt-1.5 truncate text-[22px] font-semibold tracking-[-0.015em]">
          {release.title}
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
          A manual-close release has no deadline and therefore no
          denominator — rendering an empty track and a dash reads as broken
          rather than as "no deadline". */}
      <div className="shrink-0 lg:w-52">
        {progress != null ? (
          <>
            <div className="text-muted-foreground flex justify-between text-[10.5px] tracking-[0.1em] uppercase">
              <span>{tr("release.hero.progress")}</span>
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
          <div className="text-muted-foreground text-[10.5px] tracking-[0.1em] uppercase">
            {tr("release.ledger.window")}
          </div>
        )}
        <div className="text-muted-foreground mt-1.5 text-[11.5px]">
          {release.closesAt
            ? tr("release.ledger.autoCloses", {
                args: [
                  String(i18n.l(release.closesAt, { date: "ll" })),
                  dt.of(release.closesAt).fromNow(),
                ],
              })
            : tr("release.ledger.manualOnly")}
        </div>
      </div>

      {/* Counters and the close action share one right-hand cluster rather
          than each taking a top-level column: with the page header gone this
          band carries everything, and a fifth column squeezed the title. */}
      <div className="border-border flex shrink-0 items-center gap-6 lg:border-l lg:pl-6">
        <Stat
          label={tr("release.ledger.stat.quests")}
          value={props.questCount}
        />
        <Stat label={tr("release.ledger.stat.areas")} value={props.areaCount} />
        <Stat
          label={tr("release.ledger.stat.members")}
          value={props.contributorCount}
        />
        {/* Mirrors where Start Release sits on the empty banner: the one
            action that changes the state the banner reports. */}
        <Button
          variant="outline"
          className="border-amber-500/60 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
          onClick={props.onClose}
        >
          <Square className="size-4" />
          {tr("release.close")}
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
    <div className="text-muted-foreground text-[10px] tracking-[0.1em] uppercase">
      {props.label}
    </div>
    <div className="mt-0.5 text-[22px] font-bold">{props.value}</div>
  </div>
);

export default ReleaseLedgerHero;
