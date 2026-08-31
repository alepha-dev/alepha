import { Segmented } from "@alepha/ui/components/ui/segmented";
import { ArrowRight } from "lucide-react";

import { ANALYTICS_RANGES } from "./analyticsModel.ts";
import type { AnalyticsWindow } from "./analyticsTypes.ts";
import { ClauseLabel } from "./ClauseLabel.tsx";

export interface RangeControlProps {
  days: number;
  window: AnalyticsWindow;
  onChange: (days: number) => void;
}

/**
 * The `on range` clause: how long the window is.
 *
 * A length, not a pair of bounds: `until` in Advanced decides where it ends,
 * and the resolved dates underneath are what the two controls add up to. The
 * label is `on range` rather than "window" because the alerts editor already
 * owns that word for its evaluation window, and this control does not own
 * both ends of anything.
 */
export const RangeControl = (props: RangeControlProps) => (
  <div className="flex flex-col gap-[7px]">
    <ClauseLabel>on range</ClauseLabel>
    <Segmented
      className="self-start"
      size="sm"
      value={String(props.days)}
      onChange={(value) => props.onChange(Number(value))}
      options={ANALYTICS_RANGES.map((days) => ({
        value: String(days),
        label: `${days}d`,
      }))}
    />
    <div className="text-muted-foreground flex items-center gap-1.5 font-mono text-[11px]">
      <span>{props.window.from}</span>
      <ArrowRight className="size-[11px]" />
      <span>{props.window.to}</span>
    </div>
  </div>
);
