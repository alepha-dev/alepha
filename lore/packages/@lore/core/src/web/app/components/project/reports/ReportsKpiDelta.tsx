import { useI18n } from "alepha/react/i18n";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import type { I18n } from "../../../services/I18n.ts";

export interface ReportsKpiDeltaProps {
  /**
   * This figure against the previous period's. `upIsGood` colours it, since
   * a rise in throughput and a rise in cycle time are opposite news; a
   * neutral figure (open quests) leaves it out and stays uncoloured.
   */
  delta: {
    current: number;
    previous: number;
    upIsGood?: boolean;
    /**
     * Formats the difference. A rounded integer otherwise.
     */
    format?: (difference: number) => string;
  };
}

/**
 * The change, with its direction as an arrow: the colour is never the only
 * thing saying which way it moved.
 */
const ReportsKpiDelta = (props: ReportsKpiDeltaProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { current, previous, upIsGood, format } = props.delta;
  const difference = current - previous;
  const Icon = difference > 0 ? ArrowUp : difference < 0 ? ArrowDown : Minus;
  const good = upIsGood === undefined ? undefined : difference > 0 === upIsGood;
  const tone =
    difference === 0 || good === undefined
      ? "text-muted-foreground"
      : good
        ? "text-success-text"
        : "text-danger-text";
  const text = format
    ? format(Math.abs(difference))
    : String(Math.round(Math.abs(difference)));

  return (
    <span
      className={`flex items-center gap-0.5 text-xs tabular-nums ${tone}`}
      data-testid="reports-kpi-delta"
    >
      <Icon className="size-3" />
      {tr("reports.delta", { args: [text] })}
    </span>
  );
};

export default ReportsKpiDelta;
