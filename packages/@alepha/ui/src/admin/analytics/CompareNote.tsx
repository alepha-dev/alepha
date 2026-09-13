import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";

import type {
  AnalyticsCompareMode,
  AnalyticsWindow,
} from "./analyticsTypes.ts";

export interface CompareNoteProps {
  compare: AnalyticsCompareMode;
  days: number;
  baselineWindow: AnalyticsWindow | null;
  className?: string;
}

/**
 * What the deltas are measured against, stated in full.
 *
 * `+42%` on its own is unreadable, so the baseline is never left implicit:
 * this line names it and gives its dates, and appears both under the
 * `compare to` control and in the results context line above the cards.
 */
export const CompareNote = (props: CompareNoteProps) => {
  const { tr } = useI18n();

  if (props.compare === "off" || !props.baselineWindow) {
    return (
      <span className={cn("text-muted-foreground", props.className)}>
        {tr("admin.analytics.compareOffNote", {
          default: "No baseline, so deltas are hidden.",
        })}
      </span>
    );
  }

  const range = `${props.baselineWindow.from} → ${props.baselineWindow.to}`;
  return (
    <span className={cn("text-muted-foreground", props.className)}>
      {props.compare === "lastYear"
        ? tr("admin.analytics.compareLastYearNote", {
            default: "vs same window last year ($1)",
            args: [range],
          })
        : tr("admin.analytics.comparePreviousNote", {
            default: "vs previous $1d ($2)",
            args: [String(props.days), range],
          })}
    </span>
  );
};
