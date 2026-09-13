import { Segmented } from "@alepha/ui/components/ui/segmented";
import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { ANALYTICS_LIMITS } from "./analyticsModel.ts";
import type {
  AnalyticsCompareMode,
  AnalyticsQueryState,
  AnalyticsUntilMode,
  AnalyticsWindow,
} from "./analyticsTypes.ts";
import { ClauseLabel } from "./ClauseLabel.tsx";
import { CompareNote } from "./CompareNote.tsx";

export interface AdvancedSectionProps {
  state: AnalyticsQueryState;
  window: AnalyticsWindow;
  baselineWindow: AnalyticsWindow | null;
  dirty: boolean;
  onUntilMode: (mode: AnalyticsUntilMode) => void;
  onCompare: (mode: AnalyticsCompareMode) => void;
  onLimit: (limit: number) => void;
}

/**
 * `until`, `compare to` and `limit`, folded away.
 *
 * Chosen by frequency: `from`, `select`, `on range` and `group by` are the
 * query, `where` and the time grain are the exploratory moves, and these
 * three are set once.
 *
 * `until` and `compare to` change the arithmetic, so neither can ever be
 * silently off-default. Collapsed, the header states the effective values;
 * when any of them is off-default the summary switches to just what changed,
 * turns full-contrast, gains a dot, and the section forces itself open.
 * `limit` is safe to hide unconditionally, because the truncation banner
 * surfaces it in the results.
 */
export const AdvancedSection = (props: AdvancedSectionProps) => {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const expanded = open || props.dirty;
  const Caret = expanded ? ChevronDown : ChevronRight;

  const summary = props.dirty
    ? [
        props.state.untilMode !== "yesterday" &&
          tr("admin.analytics.summaryUntilToday", { default: "until today" }),
        props.state.compare === "off"
          ? tr("admin.analytics.summaryNoBaseline", { default: "no baseline" })
          : props.state.compare === "lastYear"
            ? tr("admin.analytics.summaryLastYear", {
                default: "vs last year",
              })
            : null,
        props.state.limit !== 200 &&
          tr("admin.analytics.summaryLimit", {
            default: "limit $1",
            args: [String(props.state.limit)],
          }),
      ]
        .filter(Boolean)
        .join(" · ")
    : tr("admin.analytics.summaryDefaults", {
        default: "until yesterday · vs previous $1d · limit $2",
        args: [String(props.state.days), String(props.state.limit)],
      });

  return (
    <div className="flex flex-col gap-[9px]">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen((current) => !current)}
        className="hover:bg-muted/40 focus-visible:ring-ring/50 -mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-md px-2 py-[7px] text-left focus-visible:ring-[3px] focus-visible:outline-none"
      >
        <Caret className="text-muted-foreground size-3.5 flex-none" />
        <span className="min-w-0 flex-1">
          <ClauseLabel className="block">advanced</ClauseLabel>
          <span
            className={cn(
              "mt-0.5 block text-[11px] leading-snug",
              props.dirty ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {summary}
          </span>
        </span>
        {props.dirty && (
          <span className="bg-primary size-1.5 flex-none rounded-full" />
        )}
      </button>
      {expanded && (
        <div className="border-border flex flex-col gap-3.5 border-l pl-[11px]">
          <div className="flex flex-col gap-[7px]">
            <ClauseLabel>until</ClauseLabel>
            <Segmented
              className="self-start"
              size="sm"
              value={props.state.untilMode}
              onChange={(value) =>
                props.onUntilMode(value as AnalyticsUntilMode)
              }
              options={[
                { value: "yesterday", label: "yesterday" },
                { value: "today", label: "today" },
              ]}
            />
            <div className="text-muted-foreground text-[10.5px] leading-normal">
              {props.state.untilMode === "yesterday"
                ? tr("admin.analytics.untilYesterdayNote", {
                    default: "Ends $1, the last complete UTC day.",
                    args: [props.window.to],
                  })
                : tr("admin.analytics.untilTodayNote", {
                    default:
                      "Ends today: the newest bucket is partial, and is drawn ghosted.",
                  })}
            </div>
          </div>
          <div className="flex flex-col gap-[7px]">
            <ClauseLabel>compare to</ClauseLabel>
            <Segmented
              className="self-start"
              size="sm"
              value={props.state.compare}
              onChange={(value) =>
                props.onCompare(value as AnalyticsCompareMode)
              }
              options={[
                { value: "previous", label: "previous" },
                { value: "lastYear", label: "last year" },
                { value: "off", label: "off" },
              ]}
            />
            <CompareNote
              className="text-[10.5px] leading-normal"
              compare={props.state.compare}
              days={props.state.days}
              baselineWindow={props.baselineWindow}
            />
          </div>
          <div className="flex flex-col gap-[7px]">
            <ClauseLabel>limit</ClauseLabel>
            <Segmented
              className="self-start"
              size="sm"
              value={String(props.state.limit)}
              onChange={(value) => props.onLimit(Number(value))}
              options={ANALYTICS_LIMITS.map((limit) => ({
                value: String(limit),
                label: String(limit),
              }))}
            />
          </div>
        </div>
      )}
    </div>
  );
};
