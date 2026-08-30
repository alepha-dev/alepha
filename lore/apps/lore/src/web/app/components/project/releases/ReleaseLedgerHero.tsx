import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Pencil, Square } from "lucide-react";

import type { Release } from "@/api/entities/releases.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ReleaseLedgerHeroProps {
  release: Release;
  questCount: number;
  areaCount: number;
  contributorCount: number;
  onOpenDetail: () => void;
  /**
   * Opens the close-release modal. This lives here rather than in a page
   * header because the banner is the page's statement of current state, and
   * closing is the one action that changes it. It is also the only close
   * affordance on the page, so it cannot be dropped without stranding
   * `closeRelease`.
   */
  onClose: () => void;
}

/**
 * The band that sits above the changelog for an open release: number
 * medallion, what it is, and the three counters the changelog rolls up to.
 *
 * ⚠️ It used to carry a progress bar measuring **time spent** against
 * `closesAt`, because a milestone had a window rather than a plan. Nothing
 * closes on a timer now, so there is no window to draw. The bar that belongs
 * here is work done against work attached, and it arrives with the progress
 * rollup (#1555) rather than being faked from a date in the meantime.
 */
const ReleaseLedgerHero = (props: ReleaseLedgerHeroProps) => {
  const { release } = props;
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);

  return (
    <div className="bg-card border-border flex flex-col gap-6 border-b px-5 py-5 transition-colors lg:flex-row lg:items-center lg:gap-7 lg:px-7">
      <div className="relative flex size-13 shrink-0 items-center justify-center rounded-full bg-green-600 text-xl font-bold text-white">
        {release.number}
        <span className="ring-card absolute -right-px -bottom-px size-3 animate-pulse rounded-full bg-green-400 ring-2" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5 text-[10.5px] font-semibold tracking-[0.16em] text-green-600 uppercase dark:text-green-400">
          {tr("release.ledger.open")}
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
        {/* One tag, not a free-form label list. `releases.tags` is gone:
            `release.tag` beside `release.tags` was a one-character trap, and
            the tag is the identity rather than a decoration. */}
        {release.tag && (
          <div className="mt-2.5">
            <Badge variant="outline" className="font-mono text-[11px]">
              {release.tag}
            </Badge>
          </div>
        )}
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
        {/* The one action that changes the state this band reports. */}
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
