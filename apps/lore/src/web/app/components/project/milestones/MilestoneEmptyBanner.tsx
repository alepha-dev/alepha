import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { Library, Play } from "lucide-react";

import type { I18n } from "@/web/app/services/I18n.ts";

export interface MilestoneEmptyBannerProps {
  /** Quests completed since the last close — see `getMilestoneBacklog`. */
  backlogCount: number;
  /** `#4 July release`, when a milestone has ever closed. */
  lastLabel?: string;
  /** Localized close date of that milestone. */
  lastClosedOn?: string;
  /** Localized auto-close setting, e.g. "Manual" or "2 weeks". */
  autoCloseLabel: string;
  settingsHref: string;
  onStart: () => void;
}

/**
 * Shown when no milestone is recording. The sentence is the point: completed
 * work is piling up outside every changelog, and it names how much. An empty
 * state that only says "empty" gives the reader no reason to act.
 *
 * Full-bleed rather than a card: this is the first thing on the page now that
 * the header is gone, so it has to read as a band flush under the breadcrumb.
 * Its own horizontal padding matches what the page wrapper used to add, and a
 * plain bottom border separates it from the changelog row —
 * {@link MilestoneLedgerHero} carries the same treatment so the two states
 * occupy an identical band.
 */
const MilestoneEmptyBanner = (props: MilestoneEmptyBannerProps) => {
  const { tr } = useI18n<I18n, "en">();

  const body =
    props.backlogCount === 0
      ? tr("milestone.ledger.empty.bodyNone")
      : props.lastLabel && props.lastClosedOn
        ? tr("milestone.ledger.empty.body", {
            args: [
              String(props.backlogCount),
              props.lastLabel,
              props.lastClosedOn,
            ],
          })
        : tr("milestone.ledger.empty.bodyNoHistory", {
            args: [String(props.backlogCount)],
          });

  return (
    <div className="bg-card border-border flex flex-col gap-5 border-b px-5 py-5 md:flex-row md:items-center md:gap-6 lg:px-7">
      <div className="bg-muted text-muted-foreground flex size-13 shrink-0 items-center justify-center rounded-xl">
        <Library className="size-6" />
      </div>

      <div className="min-w-0 flex-1">
        <h2 className="text-[19px] font-semibold">
          {tr("milestone.ledger.empty.title")}
        </h2>
        <p className="text-muted-foreground mt-1.5 max-w-2xl text-[13px] text-pretty">
          {body}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
        <Button
          onClick={props.onStart}
          className="bg-green-600 px-4 text-white hover:bg-green-700"
        >
          <Play className="size-4" />
          {tr("milestone.start")}
        </Button>
        <div className="text-muted-foreground text-[11.5px]">
          {tr("milestone.ledger.autoClose", { args: [props.autoCloseLabel] })}{" "}
          <Link
            href={props.settingsHref}
            className="underline underline-offset-2"
          >
            {tr("milestone.ledger.autoClose.change")}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default MilestoneEmptyBanner;
